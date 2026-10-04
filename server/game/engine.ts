import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  ActionSubmission,
  ActionType,
  GameEvent,
  GameEventBody,
  GameSummary,
  HumanRequest,
  PlayerInfo,
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
import {
  MAX_ATTEMPTS,
  PLAYER_COUNT,
  ROLES,
  TEAM_SIZES,
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
const MISSION_MIN_MS = 8000;
const MISSION_JITTER_MS = 4000;

class GameAborted extends Error {}

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
  private readonly abortController = new AbortController();

  static create(store: GameStore, humanNames: string[]): Game {
    const humanSeats = new Set(shuffle(seatsFrom(1)).slice(0, humanNames.length));
    const personas = shuffle(PERSONAS);
    const roles = shuffle(ROLES);

    const players: PlayerInfo[] = [];
    const personaDescriptions: Record<number, string> = {};
    const humanTokens: Record<number, string> = {};
    let h = 0;
    let a = 0;
    for (const seat of seatsFrom(1)) {
      if (humanSeats.has(seat)) {
        players.push({ seat, name: humanNames[h++], kind: 'human', persona: '' });
        humanTokens[seat] = randomBytes(16).toString('hex');
      } else {
        const p = personas[a++];
        players.push({ seat, name: p.name, kind: 'ai', persona: p.tag });
        personaDescriptions[seat] = p.description;
      }
    }

    const record: GameRecord = {
      id: new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '') + '-' + randomUUID().slice(0, 6),
      createdAt: Date.now(),
      status: 'running',
      players,
      personas: personaDescriptions,
      roles: Object.fromEntries(roles.map((r, i) => [i + 1, r])),
      firstLeader: 1 + Math.floor(Math.random() * PLAYER_COUNT),
      sessions: Object.fromEntries(players.filter((p) => p.kind === 'ai').map((p) => [p.seat, null])),
      humanTokens,
    };
    store.saveRecord(record);
    return new Game(record, store);
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

  get hasHumans(): boolean {
    return Object.keys(this.record.humanTokens).length > 0;
  }

  private isHuman(seat: number): boolean {
    return seat in this.record.humanTokens;
  }

  summary(): GameSummary {
    const { id, createdAt, status, winner, players } = this.record;
    return { id, createdAt, status, winner, players, hasHumans: this.hasHumans };
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
    if (submission.action !== pending.request.action) return `现在需要的动作是 ${pending.request.action}`;
    const error = pending.validate(submission);
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
    return lines.join('\n\n');
  }

  private checkAborted(): void {
    if (this.abortController.signal.aborted) throw new GameAborted();
  }

  private setActing(seat: number, action: ActionType, active: boolean): void {
    if (active) this.acting.set(seat, action);
    else this.acting.delete(seat);
    this.broadcast({ kind: 'status', seat, action, active });
  }

  // ---------- 询问玩家 ----------

  private ask(
    seat: number,
    action: ActionType,
    ctx: ActionContext,
    validate: Validator,
    fallback: () => ActionSubmission,
    extra: Partial<HumanRequest> = {},
  ): Promise<ActionSubmission> {
    return this.isHuman(seat)
      ? this.askHuman(seat, action, ctx, validate, extra)
      : this.askAI(seat, action, ctx, validate, fallback);
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
    let prompt = [pending, actionInstruction(action, ctx)].filter(Boolean).join('\n\n');

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
      const error = out.action !== action ? `本次需要的 action 是 ${action}，你提交的是 ${out.action}` : validate(out);
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

  private static teamValidator(size: number, speechRequired: boolean): Validator {
    return (o) => {
      if (speechRequired && !(o.speech && o.speech.trim())) return '缺少 speech';
      if (!o.team) return '缺少 team';
      const unique = new Set(o.team);
      if (unique.size !== o.team.length) return 'team 中有重复的座位号';
      if (o.team.some((s) => !Number.isInteger(s) || s < 1 || s > PLAYER_COUNT)) return '座位号必须在 1 到 8 之间';
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
    const { roles, players, firstLeader } = this.record;

    this.emit({ type: 'game_start', players, firstLeader }, PUBLIC);
    for (let seat = 1; seat <= PLAYER_COUNT; seat++) {
      const { text, marks } = knowledgeFor(seat, roles);
      this.emit({ type: 'role_assigned', seat, role: roles[seat], knowledge: text, marks }, only(seat));
    }

    let leader = firstLeader;
    let successes = 0;
    let failures = 0;

    for (let mission = 1; mission <= TEAM_SIZES.length; mission++) {
      const teamSize = TEAM_SIZES[mission - 1];
      let team: number[] | null = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !team; attempt++) {
        team = await this.teamRound(mission, attempt, leader, teamSize);
        leader = nextSeat(leader);
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
    const defaultTeam = () => seatsFrom(leader).slice(0, teamSize);

    const proposal = await this.ask(leader, 'propose', ctx, Game.teamValidator(teamSize, true), () => ({
      action: 'propose',
      speech: '（未能正常发言）',
      team: defaultTeam(),
    }));
    this.emit({ type: 'speech', seat: leader, kind: 'propose', text: proposal.speech! }, PUBLIC);
    this.emit({ type: 'team_proposed', leader, team: sorted(proposal.team!), final: false }, PUBLIC);

    const discussCtx: ActionContext = { ...ctx, team: sorted(proposal.team!) };
    for (const seat of seatsFrom(nextSeat(leader)).slice(0, PLAYER_COUNT - 1)) {
      const out = await this.ask(seat, 'speak', discussCtx, Game.needSpeech, () => ({ action: 'speak', speech: '（沉默）' }));
      this.emit({ type: 'speech', seat, kind: 'discuss', text: out.speech! }, PUBLIC);
    }

    const final = await this.ask(leader, 'final_team', discussCtx, Game.teamValidator(teamSize, false), () => ({
      action: 'final_team',
      team: proposal.team,
    }));
    const team = sorted(final.team!);
    if (final.speech) this.emit({ type: 'speech', seat: leader, kind: 'final', text: final.speech }, PUBLIC);
    this.emit({ type: 'team_proposed', leader, team, final: true }, PUBLIC);

    // 全员同时投票
    const voteCtx: ActionContext = { ...ctx, team };
    const seats = seatsFrom(1);
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
    const approved = approvals > PLAYER_COUNT / 2;
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

  private async assassination(): Promise<Team> {
    const { roles } = this.record;
    const evil = seatsFrom(1)
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

    const goodSeats = seatsFrom(1).filter((s) => !isEvil(roles[s]));
    const decision = await this.ask(
      assassin,
      'assassinate',
      {},
      (o) => {
        if (!(o.speech && o.speech.trim())) return '缺少 speech';
        if (o.target === undefined) return '缺少 target';
        if (!goodSeats.includes(o.target)) return `target 必须是正义方玩家的座位号（${goodSeats.join('、')}）`;
        return null;
      },
      () => ({ action: 'assassinate', speech: '（沉默）', target: goodSeats[Math.floor(Math.random() * goodSeats.length)] }),
      { targets: goodSeats },
    );
    this.emit({ type: 'speech', seat: assassin, kind: 'assassinate', text: decision.speech! }, PUBLIC);

    const target = decision.target!;
    const hit = roles[target] === 'merlin';
    this.emit({ type: 'assassination', assassin, target, targetRole: roles[target], hit }, PUBLIC);
    return hit ? this.finish('evil', `刺客刺中了梅林（${target}号）`) : this.finish('good', `刺客刺杀 ${target}号 失败，梅林幸存`);
  }

  private finish(winner: Team, reason: string): Team {
    this.emit({ type: 'game_over', winner, reason, roles: this.record.roles }, PUBLIC);
    return winner;
  }
}

function sorted(team: number[]): number[] {
  return [...team].sort((a, b) => a - b);
}
