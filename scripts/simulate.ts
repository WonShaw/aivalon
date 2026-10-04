// 不调用模型，用 8 个脚本"人类"随机行动跑完整局，检查状态机
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionSubmission, HumanRequest, StreamMessage } from '../shared/types.ts';
import { Game } from '../server/game/engine.ts';
import { GameStore } from '../server/game/store.ts';
import { messageVisible } from '../server/game/visibility.ts';

const store = new GameStore(mkdtempSync(join(tmpdir(), 'aivalon-sim-')));
const game = Game.create(store, ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛']);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function answer(r: HumanRequest): ActionSubmission {
  const seats = [1, 2, 3, 4, 5, 6, 7, 8];
  const team = () => [...seats].sort(() => Math.random() - 0.5).slice(0, r.teamSize!);
  switch (r.action) {
    case 'propose': return { action: r.action, speech: '我提名', team: team() };
    case 'speak': return { action: r.action, speech: '我发言' };
    case 'final_team': return { action: r.action, team: r.team! };
    case 'vote': return { action: r.action, vote: Math.random() < 0.6 ? 'approve' : 'reject' };
    case 'mission': return { action: r.action, mission_card: r.canFail && Math.random() < 0.5 ? 'fail' : 'success' };
    case 'evil_discuss': return { action: r.action, speech: '讨论' };
    case 'assassinate': return { action: r.action, speech: '刺杀', target: pick(r.targets!) };
  }
}

// 先试几个非法提交，确认校验生效
let checkedInvalid = false;
const seen: Record<number, string[]> = {};
game.bus.on('message', (msg: StreamMessage) => {
  for (let seat = 1; seat <= 8; seat++) {
    if (messageVisible(msg, { kind: 'player', seat }) && msg.kind === 'event') (seen[seat] ??= []).push(msg.event.type);
  }
  if (msg.kind !== 'request') return;
  const r = msg.request;
  setTimeout(() => {
    if (!checkedInvalid && r.action === 'propose') {
      checkedInvalid = true;
      console.log('invalid size ->', game.submitHuman(r.seat, { action: 'propose', speech: 'x', team: [1] }));
      console.log('wrong action ->', game.submitHuman(r.seat, { action: 'vote', vote: 'approve' }));
    }
    if (r.action === 'mission' && !r.canFail) {
      const err = game.submitHuman(r.seat, { action: 'mission', mission_card: 'fail' });
      if (!err) throw new Error('good player was allowed to fail');
    }
    const err = game.submitHuman(r.seat, answer(r));
    if (err) throw new Error(`rejected valid answer: ${err}`);
  }, 1);
});

await game.run();
const counts: Record<string, number> = {};
for (const e of game.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
console.log('status:', game.record.status, 'winner:', game.record.winner);
console.log('events:', counts);
console.log('game_over:', JSON.stringify(game.events.at(-1)));
// 每个玩家只应收到 1 条 role_assigned（自己的），且收不到 mission_cards
for (let seat = 1; seat <= 8; seat++) {
  const roleEvents = seen[seat].filter((t) => t === 'role_assigned').length;
  const cards = seen[seat].filter((t) => t === 'mission_cards').length;
  if (roleEvents !== 1 || cards !== 0) throw new Error(`seat ${seat} visibility wrong: roles=${roleEvents} cards=${cards}`);
}
console.log('visibility ok');
