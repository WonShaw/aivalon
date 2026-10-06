// 不调用模型，用 8 个脚本"人类"随机行动跑完整局，检查状态机、身份分配和信息可见性
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESETS, buildSetup } from '../shared/setup.ts';
import { ROLE_TEAM, type ActionSubmission, type HumanRequest, type RolePreference, type StreamMessage } from '../shared/types.ts';
import { Game } from '../server/game/engine.ts';
import { GameStore } from '../server/game/store.ts';
import { messageVisible } from '../server/game/visibility.ts';

const dir = mkdtempSync(join(tmpdir(), 'aivalon-sim-'));
const store = new GameStore(dir);
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
    case 'assassinate': return { action: r.action, ...(Math.random() < 0.5 ? { speech: '刺杀' } : {}), target: pick(r.targets!) }; // 刺杀宣言可选
    case 'reflect': return { action: r.action, speech: r.seat % 3 === 0 ? '' : '这局很好玩' }; // 每 3 个座位有一个跳过
  }
}

// early：从第几个行动请求起，轮到刺客时由他发起提前刺杀
async function simulate(players: number, presetName: string, prefs: RolePreference[], early?: number): Promise<void> {
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
  let requests = 0;
  let declarer: number | null = null;
  const cancelled = new Set<string>(); // 提前刺杀时被取消的请求
  game.bus.on('message', (msg: StreamMessage) => {
    for (let seat = 1; seat <= players; seat++) {
      if (messageVisible(msg, { kind: 'player', seat }) && msg.kind === 'event') (seen[seat] ??= []).push(msg.event.type);
    }
    if (msg.kind === 'request_done' && declarer !== null) cancelled.add(msg.id);
    if (msg.kind !== 'request') return;
    const r = msg.request;
    // 只有刺客在组队和任务阶段的请求可以改为提前刺杀
    const playAction = !['evil_discuss', 'assassinate', 'reflect'].includes(r.action);
    if (!!r.canAssassinate !== (roles[r.seat] === 'assassin' && playAction)) throw new Error(`canAssassinate wrong: ${roles[r.seat]} ${r.action}`);
    const declare = early !== undefined && ++requests >= early && declarer === null && r.canAssassinate;
    setTimeout(() => {
      if (declare) {
        const other = humanSeats.find((s) => s !== r.seat && game.pendingRequestFor(s));
        if (other && !game.submitHuman(other, { action: 'assassinate', target: r.seat })) throw new Error('non-assassin assassinated early');
        if (!game.submitHuman(r.seat, { action: 'assassinate', target: r.seat })) throw new Error('assassin targeted self');
        declarer = r.seat;
        const target = pick(humanSeats.filter((s) => s !== r.seat));
        const err = game.submitHuman(r.seat, { action: 'assassinate', target, ...(Math.random() < 0.5 ? { speech: '就是你' } : {}) });
        if (err) throw new Error(`early assassination rejected: ${err}`);
        return;
      }
      if (r.action === 'mission' && !r.canFail && !game.submitHuman(r.seat, { action: 'mission', mission_card: 'fail' })) {
        throw new Error('good player was allowed to fail');
      }
      const err = game.submitHuman(r.seat, answer(r, players));
      if (err && !cancelled.has(r.id)) throw new Error(`rejected valid answer: ${err}`);
    }, 1);
  });

  await game.run();

  // 提前刺杀：只亮明刺客，没有组队、投票、任务结果和刺杀讨论，直接结算
  if (declarer !== null) {
    const start = game.events.findIndex((e) => e.type === 'assassination_start');
    const e = game.events[start];
    if (e?.type !== 'assassination_start' || e.declaredBy !== declarer || e.evil.length !== 1) throw new Error('early assassination did not start');
    const after = game.events.slice(start);
    const types = after.map((x) => x.type);
    if (types.some((t) => t === 'round_start' || t === 'team_vote' || t === 'mission_result' || t === 'team_proposed')) {
      throw new Error(`game continued after early assassination: ${types.join(',')}`);
    }
    if (after.some((x) => x.type === 'speech' && x.kind === 'assassin_discuss')) throw new Error('early assassination had a discussion');
    const over = after.find((x) => x.type === 'game_over');
    if (!types.includes('assassination') || over?.type !== 'game_over' || !over.reason.startsWith('提前刺杀')) {
      throw new Error('early assassination did not finish');
    }
  }

  // 赛后交流：只能在正常结束后开一次；跳过的人没有发言事件
  if (game.record.status === 'finished') {
    if (!game.canStartPostgame()) throw new Error('postgame should be available');
    await game.runPostgame();
    if (game.canStartPostgame()) throw new Error('postgame should not start twice');
    const start = game.events.findIndex((e) => e.type === 'postgame_start');
    const reflects = game.events.filter((e) => e.type === 'speech' && e.kind === 'reflect').length;
    const expected = Array.from({ length: players }, (_, i) => i + 1).filter((s) => s % 3 !== 0).length;
    if (start < 0 || game.events.at(-1)?.type !== 'postgame_end' || reflects !== expected) {
      throw new Error(`postgame wrong: start=${start} reflects=${reflects}/${expected}`);
    }
    if (game.summary().postgame !== 'done') throw new Error('postgame status not done');
    // 从磁盘恢复后，事件和状态都要一致
    const loaded = Game.load(store, game.id)!;
    if (loaded.events.length !== game.events.length || loaded.summary().postgame !== 'done') throw new Error('load mismatch');

    // 赛后交流中途进程被停掉：磁盘上 postgame=running 且没有 postgame_end。重启后应当收尾，不再卡住
    const record = store.loadRecord(game.id)!;
    record.postgame = 'running';
    store.saveRecord(record);
    const file = join(dir, game.id, 'events.jsonl');
    writeFileSync(file, readFileSync(file, 'utf8').trimEnd().split('\n').slice(0, -1).join('\n') + '\n');
    Game.recoverInterrupted(store);
    const recovered = Game.load(store, game.id)!;
    if (
      recovered.summary().postgame !== 'done' ||
      recovered.canStartPostgame() ||
      recovered.events.length !== game.events.length ||
      recovered.events.at(-1)?.type !== 'postgame_end' ||
      recovered.events.at(-1)?.seq !== game.events.at(-1)?.seq
    ) {
      throw new Error('interrupted postgame was not recovered');
    }
  }

  for (let seat = 1; seat <= players; seat++) {
    const roleEvents = seen[seat].filter((t) => t === 'role_assigned').length;
    const cards = seen[seat].filter((t) => t === 'mission_cards').length;
    if (roleEvents !== 1 || cards !== 0) throw new Error(`seat ${seat} visibility wrong: roles=${roleEvents} cards=${cards}`);
  }
  const over2 = game.events.findLast((e) => e.type === 'game_over');
  const reflects = game.events.filter((e) => e.type === 'speech' && e.kind === 'reflect').length;
  console.log(`[${players}人·${presetName}] → ${game.record.status}, ${over2?.type === 'game_over' ? over2.reason : '?'}，赛后发言 ${reflects} 条`);
}

// 所有座位都由脚本扮演"人类"，偏好覆盖：指定身份、指定阵营、随机
const randoms = (n: number): RolePreference[] => Array.from({ length: n }, () => 'random');
await simulate(8, '标准', ['merlin', 'assassin', 'good', 'evil', ...randoms(4)]);
await simulate(8, '奥伯伦', ['oberon', 'percival', 'evil', 'good', 'good', ...randoms(3)]);
await simulate(8, '入门', ['minion', 'minion', 'loyal', 'loyal', ...randoms(4)]);
await simulate(10, '标准', ['oberon', 'mordred', 'morgana', 'assassin', 'percival', ...randoms(5)]);
await simulate(10, '不含奥伯伦', ['evil', 'evil', 'evil', 'evil', ...randoms(6)]);
await simulate(10, '入门', ['minion', 'minion', 'minion', 'loyal', 'loyal', 'loyal', 'loyal', 'loyal', ...randoms(2)]);

// 提前刺杀：刺客在不同时机发起（提名、发言、投票、出任务牌……）
for (const at of [1, 3, 9, 12, 20, 35]) await simulate(8, '标准', randoms(8), at);
await simulate(10, '标准', randoms(10), 14);

// 不可满足的偏好要报错
try {
  Game.create(store, { humans: [{ name: 'a', role: 'merlin' }, { name: 'b', role: 'merlin' }], setup: buildSetup(PRESETS[8][0].options) });
  throw new Error('duplicate merlin was accepted');
} catch (e) {
  console.log('duplicate pick rejected:', (e as Error).message);
}
// 思考摘要：对局进行中只推给观众；正常结束后玩家也能看到。任务牌结束后仍然只给观众
{
  const spectatorOnly = { kind: 'spectator' } as const;
  const thought: StreamMessage = {
    kind: 'event',
    event: { type: 'thought', seat: 2, action: 'speak', summary: '…', seq: 1, ts: 0, visibility: spectatorOnly },
  };
  const cards: StreamMessage = {
    kind: 'event',
    event: { type: 'mission_cards', mission: 1, cards: { 2: 'fail' }, seq: 2, ts: 0, visibility: spectatorOnly },
  };
  const player = { kind: 'player', seat: 1 } as const;
  if (messageVisible(thought, player) || !messageVisible(thought, player, true) || messageVisible(cards, player, true)) {
    throw new Error('thought visibility wrong');
  }
  console.log('thought visibility ok');
}

// 赛后交流中断、且事件文件最后一行被写坏：恢复不能抛错（否则服务起不来），状态仍要收尾，这局才能删除
{
  const record = store.listRecords().find((r) => r.status === 'finished')!;
  record.postgame = 'running';
  store.saveRecord(record);
  appendFileSync(join(dir, record.id, 'events.jsonl'), '{"type":"spee');
  Game.recoverInterrupted(store);
  if (store.loadRecord(record.id)!.postgame !== 'done') throw new Error('corrupt events blocked postgame recovery');
  store.deleteGame(record.id);
  console.log('corrupt events recovery ok');
}

console.log('visibility ok');
