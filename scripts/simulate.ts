// 不调用模型，用 8 个脚本"人类"随机行动跑完整局，检查状态机、身份分配和信息可见性
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESETS, buildSetup } from '../shared/setup.ts';
import { ROLE_TEAM, type ActionSubmission, type HumanRequest, type RolePreference, type StreamMessage } from '../shared/types.ts';
import { Game } from '../server/game/engine.ts';
import { GameStore } from '../server/game/store.ts';
import { messageVisible } from '../server/game/visibility.ts';

const store = new GameStore(mkdtempSync(join(tmpdir(), 'aivalon-sim-')));
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function answer(r: HumanRequest, players: number): ActionSubmission {
  const seats = Array.from({ length: players }, (_, i) => i + 1);
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

async function simulate(players: number, presetName: string, prefs: RolePreference[]): Promise<void> {
  const setup = buildSetup(PRESETS[players].find((p) => p.name === presetName)!.options);
  const humans = prefs.map((role, i) => ({ name: `玩家${i + 1}`, role }));
  const game = Game.create(store, { humans, setup });
  const { roles } = game.record;

  // 身份分配：数量与配置一致，指定的偏好都被满足
  const assigned = Object.values(roles).sort().join(',');
  if (assigned !== [...setup].sort().join(',')) throw new Error(`roles ${assigned} do not match setup`);
  const humanSeats = game.record.players.filter((p) => p.kind === 'human').map((p) => p.seat);
  prefs.forEach((pref, i) => {
    const seat = game.record.players.find((p) => p.name === `玩家${i + 1}`)!.seat;
    const role = roles[seat];
    if (pref !== 'random' && pref !== role && pref !== ROLE_TEAM[role]) throw new Error(`pref ${pref} got ${role}`);
  });
  if (humanSeats.length !== prefs.length) throw new Error('wrong human count');

  const seen: Record<number, string[]> = {};
  game.bus.on('message', (msg: StreamMessage) => {
    for (let seat = 1; seat <= players; seat++) {
      if (messageVisible(msg, { kind: 'player', seat }) && msg.kind === 'event') (seen[seat] ??= []).push(msg.event.type);
    }
    if (msg.kind !== 'request') return;
    const r = msg.request;
    setTimeout(() => {
      if (r.action === 'mission' && !r.canFail && !game.submitHuman(r.seat, { action: 'mission', mission_card: 'fail' })) {
        throw new Error('good player was allowed to fail');
      }
      const err = game.submitHuman(r.seat, answer(r, players));
      if (err) throw new Error(`rejected valid answer: ${err}`);
    }, 1);
  });

  await game.run();
  for (let seat = 1; seat <= players; seat++) {
    const roleEvents = seen[seat].filter((t) => t === 'role_assigned').length;
    const cards = seen[seat].filter((t) => t === 'mission_cards').length;
    if (roleEvents !== 1 || cards !== 0) throw new Error(`seat ${seat} visibility wrong: roles=${roleEvents} cards=${cards}`);
  }
  const over = game.events.at(-1);
  console.log(`[${players}人·${presetName}] ${prefs.join('/')} → ${game.record.status}, ${over?.type === 'game_over' ? over.reason : '?'}`);
}

// 所有座位都由脚本扮演"人类"，偏好覆盖：指定身份、指定阵营、随机
const randoms = (n: number): RolePreference[] => Array.from({ length: n }, () => 'random');
await simulate(8, '标准', ['merlin', 'assassin', 'good', 'evil', ...randoms(4)]);
await simulate(8, '奥伯伦', ['oberon', 'percival', 'evil', 'good', 'good', ...randoms(3)]);
await simulate(8, '入门', ['minion', 'minion', 'loyal', 'loyal', ...randoms(4)]);
await simulate(10, '标准', ['oberon', 'mordred', 'morgana', 'assassin', 'percival', ...randoms(5)]);
await simulate(10, '不含奥伯伦', ['evil', 'evil', 'evil', 'evil', ...randoms(6)]);
await simulate(10, '入门', ['minion', 'minion', 'minion', 'loyal', 'loyal', 'loyal', 'loyal', 'loyal', ...randoms(2)]);

// 不可满足的偏好要报错
try {
  Game.create(store, { humans: [{ name: 'a', role: 'merlin' }, { name: 'b', role: 'merlin' }], setup: buildSetup(PRESETS[8][0].options) });
  throw new Error('duplicate merlin was accepted');
} catch (e) {
  console.log('duplicate pick rejected:', (e as Error).message);
}
console.log('visibility ok');
