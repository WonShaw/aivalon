import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { ROLE_NAME } from '../../shared/types.ts';
import type {
  ActionSubmission,
  ActionType,
  CreateGameRequest,
  GameEvent,
  GameEventBody,
  GameSummary,
  HumanRequest,
  PlayerInfo,
  PostgameStatus,
  Role,
  StreamMessage,
  Team,
  Visibility,
} from '../../shared/types.ts';
import { AIPlayer, type ActResult } from '../ai/player.ts';
import { PERSONAS } from '../ai/personas.ts';
import {
  actionInstruction,
  invalidInstruction,
  renderEvent,
  sanitizeSpeech,
  type ActionContext,
} from '../ai/prompts.ts';
import { STANDARD_SETUP, buildSetup, setupOptionsOf, teamSizes } from '../../shared/setup.ts';
import {
  MAX_ATTEMPTS,
  assignRoles,
  failsRequired,
  isEvil,
  knowledgeFor,
  nextSeat,
  seatsFrom,
  shuffle,
} from './rules.ts';
import type { GameRecord, GameStore } from './store.ts';

const PUBLIC: Visibility = { kind: 'public' };
const SPECTATOR: Visibility = { kind: 'spectator' };
const only = (seat: number): Visibility => ({ kind: 'players', seats: [seat] });

const MAX_SPEECH_CHARS = 800;
const MAX_INVALID_RETRIES = 2; // AI 提交不合法时最多再问几次
const MAX_CALL_RETRIES = 3; // 调用出错（网络、限流等）时最多重试几次
// 有人类玩家时，任务结算至少等这么久，避免从结果出来的快慢推断队伍里有没有邪恶方
const MISSION_MIN_MS = Number(process.env.AIVALON_MISSION_MIN_MS ?? 8000);
const MISSION_JITTER_MS = MISSION_MIN_MS / 2;

class GameAborted extends Error {}
class EarlyAssassination extends Error {} // 刺客发起了提前刺杀，当前的组队和任务作废

type Validator = (o: ActionSubmission) => string | null;

interface PendingHuman {
  request: HumanRequest;
  validate: Validator;
  resolve: (o: ActionSubmission) => void;
  reject: (e: Error) => void;
}

export class Game {
  readonly bus = new EventEmitter();
  readonly events: GameEvent[] = [];
  private readonly ais: Record<number, AIPlayer> = {};
  private readonly cursors: Record<number, number> = {};
  private readonly acting = new Map<number, ActionType>();
  private readonly pendingHumans = new Map<number, PendingHuman>();
  private abortController = new AbortController(); // 当前阶段（对局 / 赛后交流）的中止信号
  private phase: 'play' | 'assassination' | 'over' = 'play';
  private early: { seat: number; target: number; speech?: string } | null = null; // 刺客发起的提前刺杀
  private readonly inflight = new Set<Promise<ActionSubmission>>(); // 还没结束的询问

  // 调用前需要先用 validateSetup 校验配置；人类的身份偏好无法满足时抛出错误
  static create(store: GameStore, req: CreateGameRequest): Game {
    const setup = buildSetup(setupOptionsOf(req.setup));
    const n = setup.length;
    const { humans: humanRoles, rest } = assignRoles(setup, req.humans.map((h) => h.role));
    const humanSeats = shuffle(seatsFrom(1, n)).slice(0, req.humans.length);
    // 和人类重名的 AI 性格这局不用，避免桌上出现两个同名玩家
    const humanNames = new Set(req.humans.map((h) => h.name));
    const personas = shuffle(PERSONAS.filter((p) => !humanNames.has(p.name)));
    const aiRoles = shuffle(rest);

    const players: PlayerInfo[] = [];
    const roles: Record<number, Role> = {};
    const personaDescriptions: Record<number, string> = {};
    const humanTokens: Record<number, string> = {};
    let a = 0;
    for (const seat of seatsFrom(1, n)) {
      const h = humanSeats.indexOf(seat);
      if (h >= 0) {
        players.push({ seat, name: req.humans[h].name, kind: 'human', persona: '' });
        roles[seat] = humanRoles[h];
        humanTokens[seat] = randomBytes(16).toString('hex');
      } else {
        const p = personas[a];
        players.push({ seat, name: p.name, kind: 'ai', persona: p.tag });
        roles[seat] = aiRoles[a];
        personaDescriptions[seat] = p.description;
        a++;
      }
    }

    const record: GameRecord = {
      id: new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '') + '-' + randomUUID().slice(0, 6),
      createdAt: Date.now(),
      status: 'running',
      setup,
      players,
      personas: personaDescriptions,
      roles,
      firstLeader: 1 + Math.floor(Math.random() * n),
      sessions: Object.fromEntries(players.filter((p) => p.kind === 'ai').map((p) => [p.seat, null])),
      humanTokens,
    };
    store.saveRecord(record);
    return new Game(record, store);
  }

  // 从磁盘恢复一局（例如服务重启后回看、开启赛后交流）。早期记录没有保存 AI 看到哪里，就当作都看过了
  static load(store: GameStore, id: string): Game | null {
    const record = store.loadRecord(id);
    if (!record) return null;
    record.humanTokens ??= {};
    record.setup ??= STANDARD_SETUP;
    const game = new Game(record, store);
    game.events.push(...store.loadEvents(id));
    for (const seat of Object.keys(game.ais).map(Number)) {
      game.cursors[seat] = record.cursors?.[seat] ?? game.events.length;
    }
    return game;
  }

  // 进程重启后，没跑完的对局和赛后交流都无法继续：对局标记为中止，赛后交流补上结束事件并标记为结束
  static recoverInterrupted(store: GameStore): void {
    for (const record of store.listRecords()) {
      if (record.status === 'running') {
        record.status = 'aborted';
        store.saveRecord(record);
      }
      if (record.postgame === 'running') {
        record.postgame = 'done';
        store.saveRecord(record);
        // 补上结束事件，时间线才完整。事件文件损坏（比如崩溃时写坏了最后一行）时跳过，不影响服务启动和这局的删除
        try {
          const seq = store.loadEvents(record.id).length + 1;
          store.appendEvent(record.id, { type: 'postgame_end', seq, ts: Date.now(), visibility: PUBLIC });
        } catch (err) {
          console.warn(`[game ${record.id}] 事件记录无法读取，没有补上赛后交流的结束事件：`, err instanceof Error ? err.message : err);
        }
      }
    }
  }

  private constructor(
    readonly record: GameRecord,
    private readonly store: GameStore,
  ) {
    for (const p of record.players) {
      if (p.kind !== 'ai') continue;
      this.cursors[p.seat] = 0;
      this.ais[p.seat] = new AIPlayer(p.seat, record.sessions[p.seat], {
        onSession: (s, sessionId) => {
          this.record.sessions[s] = sessionId;
          this.store.saveRecord(this.record);
        },
        onLiveSpeech: (s, action, speech) => this.broadcast({ kind: 'live', seat: s, action, speech }),
      });
    }
  }

  get id(): string {
    return this.record.id;
  }

  // 本局人数
  private get n(): number {
    return this.record.players.length;
  }

  private seatsFrom(start: number): number[] {
    return seatsFrom(start, this.n);
  }

  private nextSeat(seat: number): number {
    return nextSeat(seat, this.n);
  }

  get hasHumans(): boolean {
    return Object.keys(this.record.humanTokens).length > 0;
  }

  private isHuman(seat: number): boolean {
    return seat in this.record.humanTokens;
  }

  summary(): GameSummary {
    const { id, createdAt, status, winner, players, setup } = this.record;
    const postgame = this.record.postgame ?? 'none';
    return { id, createdAt, status, winner, players, hasHumans: this.hasHumans, setup, postgame };
  }

  actingNow(): { seat: number; action: ActionType }[] {
    return [...this.acting.entries()].map(([seat, action]) => ({ seat, action }));
  }

  seatForToken(token: string): number | null {
    const entry = Object.entries(this.record.humanTokens).find(([, t]) => t === token);
    return entry ? Number(entry[0]) : null;
  }

  pendingRequestFor(seat: number): HumanRequest | null {
    return this.pendingHumans.get(seat)?.request ?? null;
  }

  // 人类玩家提交动作；返回错误信息，或 null 表示已接受
  submitHuman(seat: number, submission: ActionSubmission): string | null {
    const pending = this.pendingHumans.get(seat);
    if (!pending) return '现在不需要你行动';
    const early = this.isEarlyAssassination(seat, pending.request.action, submission);
    if (!early && submission.action !== pending.request.action) return `现在需要的动作是 ${pending.request.action}`;
    const error = early ? this.earlyTargetError(seat, submission) : pending.validate(submission);
    if (error) return error;
    this.pendingHumans.delete(seat);
    this.broadcast({ kind: 'request_done', seat, id: pending.request.id });
    pending.resolve(submission);
    return null;
  }

  stop(): void {
    this.abortController.abort();
    for (const pending of this.pendingHumans.values()) pending.reject(new GameAborted());
    this.pendingHumans.clear();
  }

  // 刺客在组队和任务阶段轮到自己行动时，可以不做要求的动作，改为提交 assassinate 发起提前刺杀
  private canAssassinateEarly(seat: number): boolean {
    return (
      this.record.status === 'running' && this.phase === 'play' && this.early === null && this.record.roles[seat] === 'assassin'
    );
  }

  private isEarlyAssassination(seat: number, requested: ActionType, o: ActionSubmission): boolean {
    return o.action === 'assassinate' && requested !== 'assassinate' && this.canAssassinateEarly(seat);
  }

  private earlyTargetError(seat: number, o: ActionSubmission): string | null {
    if (o.target === undefined) return '缺少 target';
    if (!Number.isInteger(o.target) || o.target < 1 || o.target > this.n || o.target === seat) {
      return `target 必须是除你以外的座位号（1 到 ${this.n}）`;
    }
    return null;
  }

  // 记下提前刺杀并取消其他人类玩家还没完成的请求；正在思考的 AI 不打断，等它们做完（结果作废）再结算
  private declareEarly(seat: number, o: ActionSubmission): void {
    this.early = { seat, target: o.target!, speech: o.speech };
    for (const [s, pending] of this.pendingHumans) {
      this.broadcast({ kind: 'request_done', seat: s, id: pending.request.id });
      pending.reject(new EarlyAssassination());
    }
    this.pendingHumans.clear();
  }

  // ---------- 事件 ----------

  private broadcast(msg: StreamMessage): void {
    this.bus.emit('message', msg);
  }

  private emit(body: GameEventBody, visibility: Visibility): GameEvent {
    const event = { ...body, seq: this.events.length + 1, ts: Date.now(), visibility } as GameEvent;
    this.events.push(event);
    this.store.appendEvent(this.id, event);
    this.broadcast({ kind: 'event', event });
    return event;
  }

  private setStatus(status: GameRecord['status'], winner?: Team): void {
    this.record.status = status;
    if (winner) this.record.winner = winner;
    this.store.saveRecord(this.record);
    this.broadcast({ kind: 'game', summary: this.summary() });
  }

  private visibleTo(e: GameEvent, seat: number): boolean {
    return e.visibility.kind === 'public' || (e.visibility.kind === 'players' && e.visibility.seats.includes(seat));
  }

  // 该 AI 上次行动之后、它能看到的新事件，渲染成文本
  private pendingFor(seat: number): string {
    const ctx = {
      viewer: seat,
      players: this.record.players,
      personaDescription: this.record.personas[seat],
    };
    const lines = this.events
      .filter((e) => e.seq > this.cursors[seat] && this.visibleTo(e, seat))
      .map((e) => renderEvent(e, ctx))
      .filter((t): t is string => t !== null);
    this.cursors[seat] = this.events.length;
    this.record.cursors = { ...this.cursors };
    this.store.saveRecord(this.record);
    return lines.join('\n\n');
  }

  private checkAborted(): void {
    if (this.abortController.signal.aborted) throw new GameAborted();
    // 发起提前刺杀后，组队和任务里不再开始新的调用
    if (this.early !== null && this.phase === 'play') throw new EarlyAssassination();
  }

  private setActing(seat: number, action: ActionType, active: boolean): void {
    if (active) this.acting.set(seat, action);
    else this.acting.delete(seat);
    this.broadcast({ kind: 'status', seat, action, active });
  }

  // ---------- 询问玩家 ----------

  private async ask(
    seat: number,
    action: ActionType,
    ctx: ActionContext,
    validate: Validator,
    fallback: () => ActionSubmission,
    extra: Partial<HumanRequest> = {},
  ): Promise<ActionSubmission> {
    const task = this.isHuman(seat)
      ? this.askHuman(seat, action, ctx, validate, extra)
      : this.askAI(seat, action, ctx, validate, fallback);
    this.inflight.add(task);
    try {
      const out = await task;
      if (this.isEarlyAssassination(seat, action, out)) this.declareEarly(seat, out);
      this.checkAborted(); // 等待期间刺客发起了提前刺杀，这次的结果作废
      return out;
    } finally {
      this.inflight.delete(task);
    }
  }

  private async askHuman(
    seat: number,
    action: ActionType,
    ctx: ActionContext,
    validate: Validator,
    extra: Partial<HumanRequest>,
  ): Promise<ActionSubmission> {
    this.checkAborted();
    const request: HumanRequest = { id: randomUUID(), seat, action, ...ctx, ...extra };
    if (this.canAssassinateEarly(seat)) request.canAssassinate = true;
    this.setActing(seat, action, true);
    try {
      const out = await new Promise<ActionSubmission>((resolve, reject) => {
        this.pendingHumans.set(seat, { request, validate, resolve, reject });
        this.broadcast({ kind: 'request', request });
      });
      if (out.speech !== undefined) out.speech = sanitizeSpeech(out.speech).slice(0, MAX_SPEECH_CHARS);
      return out;
    } finally {
      this.setActing(seat, action, false);
    }
  }

  private async callAI(seat: number, action: ActionType, prompt: string): Promise<ActResult> {
    for (let attempt = 0; ; attempt++) {
      this.checkAborted();
      this.setActing(seat, action, true);
      try {
        const text = attempt === 0 ? prompt : `【裁判】（上一次请求意外中断，请重新提交。）\n\n${prompt}`;
        return await this.ais[seat].act(text, action, this.abortController.signal);
      } catch (err) {
        this.checkAborted();
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ type: 'ai_error', seat, action, message }, SPECTATOR);
        if (attempt >= MAX_CALL_RETRIES) throw err;
        await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
      } finally {
        this.setActing(seat, action, false);
      }
    }
  }

  private async askAI(
    seat: number,
    action: ActionType,
    ctx: ActionContext,
    validate: Validator,
    fallback: () => ActionSubmission,
  ): Promise<ActionSubmission> {
    const pending = this.pendingFor(seat);
    let prompt = [pending, actionInstruction(action, ctx, this.canAssassinateEarly(seat))].filter(Boolean).join('\n\n');

    for (let i = 0; i <= MAX_INVALID_RETRIES; i++) {
      const res = await this.callAI(seat, action, prompt);
      this.emit(
        {
          type: 'ai_usage',
          seat,
          action,
          costUsd: res.costUsd,
          durationMs: res.durationMs,
          cacheRead: res.usage.cacheRead,
          cacheWrite: res.usage.cacheWrite,
          input: res.usage.input,
          output: res.usage.output,
        },
        SPECTATOR,
      );
      if (res.thinking) this.emit({ type: 'thought', seat, action, summary: res.thinking }, SPECTATOR);

      const out = res.output;
      const error = this.isEarlyAssassination(seat, action, out)
        ? this.earlyTargetError(seat, out)
        : out.action !== action
          ? `本次需要的 action 是 ${action}，你提交的是 ${out.action}`
          : validate(out);
      if (!error) {
        if (out.speech !== undefined) out.speech = sanitizeSpeech(out.speech).slice(0, MAX_SPEECH_CHARS);
        return out;
      }
      this.emit({ type: 'ai_error', seat, action, message: `提交无效：${error}` }, SPECTATOR);
      prompt = invalidInstruction(action, error);
    }

    this.emit({ type: 'ai_error', seat, action, message: '多次提交无效，裁判代为执行默认动作' }, SPECTATOR);
    return fallback();
  }

  // ---------- 校验 ----------

  private static needSpeech: Validator = (o) => (o.speech && o.speech.trim() ? null : '缺少 speech');

  private static teamValidator(size: number, players: number, speechRequired: boolean): Validator {
    return (o) => {
      if (speechRequired && !(o.speech && o.speech.trim())) return '缺少 speech';
      if (!o.team) return '缺少 team';
      const unique = new Set(o.team);
      if (unique.size !== o.team.length) return 'team 中有重复的座位号';
      if (o.team.some((s) => !Number.isInteger(s) || s < 1 || s > players)) return `座位号必须在 1 到 ${players} 之间`;
      if (o.team.length !== size) return `队伍人数必须正好是 ${size} 人，你提名了 ${o.team.length} 人`;
      return null;
    };
  }

  // ---------- 主流程 ----------

  async run(): Promise<void> {
    try {
      const winner = await this.play();
      this.setStatus('finished', winner);
    } catch (err) {
      if (err instanceof GameAborted || this.abortController.signal.aborted) {
        this.setStatus('aborted');
      } else {
        console.error(`[game ${this.id}]`, err);
        this.setStatus('error');
      }
    }
  }

  private async play(): Promise<Team> {
    const { roles, players, firstLeader, setup } = this.record;

    this.emit({ type: 'game_start', players, firstLeader, setup }, PUBLIC);
    for (let seat = 1; seat <= this.n; seat++) {
      const { text, marks } = knowledgeFor(seat, roles);
      this.emit({ type: 'role_assigned', seat, role: roles[seat], knowledge: text, marks }, only(seat));
    }

    try {
      return await this.playMissions();
    } catch (err) {
      if (this.early === null || this.abortController.signal.aborted) throw err;
      // 等还在思考的 AI 做完再结算，之后它们还要被问话，同一个 AI 会话不能同时有两个调用
      await Promise.allSettled([...this.inflight]);
      return this.earlyAssassination(this.early);
    }
  }

  private async playMissions(): Promise<Team> {
    const { firstLeader } = this.record;
    let leader = firstLeader;
    let successes = 0;
    let failures = 0;

    const sizes = teamSizes(this.n);
    for (let mission = 1; mission <= sizes.length; mission++) {
      const teamSize = sizes[mission - 1];
      let team: number[] | null = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !team; attempt++) {
        team = await this.teamRound(mission, attempt, leader, teamSize);
        leader = this.nextSeat(leader);
        if (!team && attempt === MAX_ATTEMPTS) {
          return this.finish('evil', `第 ${mission} 个任务连续 ${MAX_ATTEMPTS} 次组队失败`);
        }
      }

      const success = await this.runMission(mission, team!);
      if (success) successes++;
      else failures++;

      if (failures >= 3) return this.finish('evil', '3 个任务失败');
      if (successes >= 3) return this.assassination();
    }
    throw new Error('unreachable');
  }

  // 一次组队：队长提名 → 依次发言 → 队长最终提名 → 全员投票。组队成功返回队伍，否则返回 null
  private async teamRound(mission: number, attempt: number, leader: number, teamSize: number): Promise<number[] | null> {
    this.emit({ type: 'round_start', mission, attempt, leader, teamSize, failsRequired: failsRequired(mission) }, PUBLIC);
    const ctx: ActionContext = { mission, attempt, leader, teamSize };
    const defaultTeam = () => this.seatsFrom(leader).slice(0, teamSize);

    const proposal = await this.ask(leader, 'propose', ctx, Game.teamValidator(teamSize, this.n, true), () => ({
      action: 'propose',
      speech: '（未能正常发言）',
      team: defaultTeam(),
    }));
    this.emit({ type: 'speech', seat: leader, kind: 'propose', text: proposal.speech! }, PUBLIC);
    this.emit({ type: 'team_proposed', leader, team: sorted(proposal.team!), final: false }, PUBLIC);

    const discussCtx: ActionContext = { ...ctx, team: sorted(proposal.team!) };
    for (const seat of this.seatsFrom(this.nextSeat(leader)).slice(0, this.n - 1)) {
      const out = await this.ask(seat, 'speak', discussCtx, Game.needSpeech, () => ({ action: 'speak', speech: '（沉默）' }));
      this.emit({ type: 'speech', seat, kind: 'discuss', text: out.speech! }, PUBLIC);
    }

    const final = await this.ask(leader, 'final_team', discussCtx, Game.teamValidator(teamSize, this.n, false), () => ({
      action: 'final_team',
      team: proposal.team,
    }));
    const team = sorted(final.team!);
    if (final.speech) this.emit({ type: 'speech', seat: leader, kind: 'final', text: final.speech }, PUBLIC);
    this.emit({ type: 'team_proposed', leader, team, final: true }, PUBLIC);

    // 全员同时投票
    const voteCtx: ActionContext = { ...ctx, team };
    const seats = this.seatsFrom(1);
    const outs = await Promise.all(
      seats.map((seat) =>
        this.ask(
          seat,
          'vote',
          voteCtx,
          (o) => (o.vote ? null : '缺少 vote'),
          () => ({ action: 'vote', vote: 'approve' }),
        ),
      ),
    );
    const votes = Object.fromEntries(seats.map((seat, i) => [seat, outs[i].vote!])) as Record<number, 'approve' | 'reject'>;
    const approvals = Object.values(votes).filter((v) => v === 'approve').length;
    const approved = approvals > this.n / 2;
    this.emit({ type: 'team_vote', mission, attempt, team, votes, approved }, PUBLIC);
    return approved ? team : null;
  }

  // 执行任务：所有队员同时出牌（正义方只能出成功）
  private async runMission(mission: number, team: number[]): Promise<boolean> {
    const { roles } = this.record;
    const ctx: ActionContext = { mission, team };
    const minDelay = this.hasHumans
      ? new Promise((r) => setTimeout(r, MISSION_MIN_MS + Math.random() * MISSION_JITTER_MS))
      : Promise.resolve();

    const cardsPromise = Promise.all(
      team.map(async (seat) => {
        const evil = isEvil(roles[seat]);
        const out = await this.ask(
          seat,
          'mission',
          ctx,
          (o) => {
            if (!o.mission_card) return '缺少 mission_card';
            if (o.mission_card === 'fail' && !evil) return '正义方只能出 success';
            return null;
          },
          () => ({ action: 'mission', mission_card: 'success' }),
          { canFail: evil },
        );
        return out.mission_card!;
      }),
    );
    const [cards] = await Promise.all([cardsPromise, minDelay]);
    const cardMap = Object.fromEntries(team.map((seat, i) => [seat, cards[i]]));
    this.emit({ type: 'mission_cards', mission, cards: cardMap }, SPECTATOR);

    const fails = cards.filter((c) => c === 'fail').length;
    const success = fails < failsRequired(mission);
    this.emit({ type: 'mission_result', mission, team, fails, success }, PUBLIC);
    return success;
  }

  // 正义方完成 3 个任务后进入刺杀：邪恶方亮明身份并讨论，最后由刺客决定
  private async assassination(): Promise<Team> {
    this.phase = 'assassination';
    const { roles } = this.record;
    const evil = this.seatsFrom(1)
      .filter((s) => isEvil(roles[s]))
      .map((seat) => ({ seat, role: roles[seat] }));
    const assassin = evil.find((e) => e.role === 'assassin')!.seat;
    this.emit({ type: 'assassination_start', evil }, PUBLIC);

    // 刺客先发言，然后其他邪恶方玩家发言，最后刺客做决定
    const order = [assassin, ...evil.map((e) => e.seat).filter((s) => s !== assassin)];
    for (const seat of order) {
      const out = await this.ask(seat, 'evil_discuss', {}, Game.needSpeech, () => ({
        action: 'evil_discuss',
        speech: '（沉默）',
      }));
      this.emit({ type: 'speech', seat, kind: 'assassin_discuss', text: out.speech! }, PUBLIC);
    }

    const goodSeats = this.seatsFrom(1).filter((s) => !isEvil(roles[s]));
    const decision = await this.ask(
      assassin,
      'assassinate',
      {},
      (o) => {
        if (o.target === undefined) return '缺少 target';
        if (!goodSeats.includes(o.target)) return `target 必须是正义方玩家的座位号（${goodSeats.join('、')}）`;
        return null;
      },
      () => ({ action: 'assassinate', target: goodSeats[Math.floor(Math.random() * goodSeats.length)] }),
      { targets: goodSeats },
    );
    // 刺杀宣言可选
    if (decision.speech?.trim()) this.emit({ type: 'speech', seat: assassin, kind: 'assassinate', text: decision.speech }, PUBLIC);

    return this.settleAssassination(assassin, decision.target!, '');
  }

  // 刺客提前发起刺杀：只亮明刺客身份，不讨论，直接按刺客选的目标结算
  private earlyAssassination({ seat, target, speech }: { seat: number; target: number; speech?: string }): Team {
    this.phase = 'assassination';
    this.emit({ type: 'assassination_start', evil: [{ seat, role: 'assassin' }], declaredBy: seat }, PUBLIC);
    if (speech?.trim()) this.emit({ type: 'speech', seat, kind: 'assassinate', text: speech }, PUBLIC);
    return this.settleAssassination(seat, target, '提前刺杀：');
  }

  private settleAssassination(assassin: number, target: number, prefix: string): Team {
    const hit = this.record.roles[target] === 'merlin';
    this.emit({ type: 'assassination', assassin, target, targetRole: this.record.roles[target], hit }, PUBLIC);
    return hit
      ? this.finish('evil', `${prefix}刺客刺中了梅林（${target}号）`)
      : this.finish('good', `${prefix}刺客刺杀 ${target}号 失败，梅林幸存`);
  }

  private finish(winner: Team, reason: string): Team {
    this.phase = 'over';
    this.emit({ type: 'game_over', winner, reason, roles: this.record.roles }, PUBLIC);
    return winner;
  }

  // ---------- 赛后交流 ----------

  // 赛后交流只能在对局正常结束后开一次
  canStartPostgame(): boolean {
    return this.record.status === 'finished' && (this.record.postgame ?? 'none') === 'none';
  }

  private setPostgame(postgame: PostgameStatus): void {
    this.record.postgame = postgame;
    this.store.saveRecord(this.record);
    this.broadcast({ kind: 'game', summary: this.summary() });
  }

  // 本局结果和全部身份，给 AI 做赛后交流的背景
  private recap(): string {
    const over = this.events.findLast((e) => e.type === 'game_over');
    if (over?.type !== 'game_over') return '';
    const name = (seat: number) => this.record.players.find((p) => p.seat === seat)?.name ?? `${seat}号`;
    const roles = this.seatsFrom(1)
      .map((s) => `${s}号「${name(s)}」${ROLE_NAME[over.roles[s]]}`)
      .join('，');
    return `${over.winner === 'good' ? '正义方' : '邪恶方'}获胜（${over.reason}）。全部身份：${roles}。`;
  }

  // 每人按座位顺序发言一次；人类可以跳过（提交空发言）
  async runPostgame(): Promise<void> {
    this.abortController = new AbortController();
    this.setPostgame('running');
    this.emit({ type: 'postgame_start' }, PUBLIC);
    const ctx: ActionContext = { recap: this.recap() };
    try {
      for (const seat of this.seatsFrom(1)) {
        const human = this.isHuman(seat);
        const out = await this.ask(
          seat,
          'reflect',
          ctx,
          human ? () => null : Game.needSpeech,
          () => ({ action: 'reflect', speech: '（没有发言）' }),
        );
        if (out.speech?.trim()) this.emit({ type: 'speech', seat, kind: 'reflect', text: out.speech }, PUBLIC);
      }
    } catch (err) {
      if (!(err instanceof GameAborted) && !this.abortController.signal.aborted) {
        console.error(`[game ${this.id}] postgame`, err);
      }
    } finally {
      this.emit({ type: 'postgame_end' }, PUBLIC);
      this.setPostgame('done');
    }
  }
}

function sorted(team: number[]): number[] {
  return [...team].sort((a, b) => a - b);
}
