import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ROLE_NAME, type GameEvent, type PlayerInfo, type SpeechKind } from '../shared/types.ts';
import { playerName } from './format.ts';
import type { StreamState } from './useGameStream.ts';

// 语音朗读：用浏览器自带的 Web Speech API 读出发言和流程播报。免费；优先用系统自带的本机声音，离线可用
// （Chrome 里名字带 Google 的声音是联网合成的，只在没有本机中文声音时才会用到）。
// 开启后，服务端照常推送，前端把新事件放进缓冲队列，按顺序一条条显示：要朗读的读完再显示下一条，
// 不用读的直接显示。关闭朗读时所有事件立即显示。

// 一段话由哪个声音读：seat 为 null 时是裁判
interface Segment {
  seat: number | null;
  text: string;
}

export interface PlaybackState {
  supported: boolean;
  hasChinese: boolean; // 找到了中文声音（没有时浏览器会用默认声音读，可能读不了中文）
  reading: number | null; // 正在朗读的事件 seq
  speakingSeat: number | null; // 正在用自己的声音发言的座位（裁判播报时为 null）
  pending: number; // 缓冲队列里还没显示、需要朗读的条数
  caughtUp: boolean; // 已经显示到最新：队列空了，也没有在读
  blocked: boolean; // 浏览器要求先和页面交互才能出声
}

// 声音不够分时，共用同一个声音的座位用略微不同的音调和语速区分。幅度大了会变成尖嗓子或怪声
const SEAT_PITCH = [1, 0.92, 1.08, 0.96, 1.04, 0.9, 1.1, 0.94, 1.06, 0.98];
const SEAT_RATE = [1, 0.96, 1.04, 1.06, 0.95, 1, 1.03, 0.94, 1, 1.05];

// macOS 的 Eloquence 声音（给读屏用的老式合成引擎），听起来像机器人
const ROBOTIC = /eloquence|^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;
// 声音的音质：系统设置里下载的高音质（Premium）声音和 Edge 的神经网络声音最好，其次是优化音质（Enhanced）
const PREMIUM = /premium|natural|neural|高音质|高级/i;
const ENHANCED = /enhanced|优化|增强/i;

// 同一个声音的不同音质版本，例如"婷婷"和"婷婷（优化音质）"
const baseName = (v: SpeechSynthesisVoice) => v.name.replace(/\s*[（(].*$/, '');

const SPEECH_LABEL: Partial<Record<SpeechKind, string>> = {
  propose: '提名发言',
  final: '最终提名',
  assassin_discuss: '刺杀讨论',
  assassinate: '刺杀宣言',
};

const MAX_CHUNK = 120;

// 按句子切成短段：长文本一次读完容易被浏览器中途掐断，短段也便于随时停下
function splitText(text: string): string[] {
  const sentences = text
    .replace(/[＜＞＠]/g, ' ')
    .split(/(?<=[。！？!?；;…\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (buf && buf.length + s.length > MAX_CHUNK) {
      chunks.push(buf);
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

const seatList = (seats: number[]) => seats.map((s) => `${s}号`).join('、');

// 把一条事件变成要读的内容；不需要读的返回 null。godView 表示开着上帝视角，时间线上能看到每张任务牌
export function narrate(e: GameEvent, players: PlayerInfo[], mySeat: number | null, godView = false): Segment[] | null {
  const who = (seat: number) => `${seat}号${playerName(players, seat)}`;
  const say = (text: string): Segment[] => [{ seat: null, text }];
  switch (e.type) {
    case 'game_start':
      return say(`游戏开始，首位队长是${who(e.firstLeader)}。`);
    case 'round_start':
      return say(
        `第${e.mission}个任务，第${e.attempt}次组队${e.attempt === 5 ? '，这是最后一次机会' : ''}。` +
          `队长${who(e.leader)}，需要${e.teamSize}人。`,
      );
    case 'speech': {
      if (e.seat === mySeat) return null;
      const label = SPEECH_LABEL[e.kind];
      return [
        { seat: null, text: `${who(e.seat)}${label ? `，${label}` : ''}。` },
        { seat: e.seat, text: e.text },
      ];
    }
    case 'team_proposed':
      return say(`${e.final ? '最终提名' : '初步提名'}：${seatList(e.team)}。`);
    case 'team_vote': {
      const votes = Object.values(e.votes);
      const approvals = votes.filter((v) => v === 'approve').length;
      return say(
        `投票结果：${approvals}票赞成，${votes.length - approvals}票反对，组队${e.approved ? '成功' : '失败'}。` +
          (e.approved ? '开始执行任务，出任务牌。' : ''),
      );
    }
    case 'mission_cards': {
      if (!godView) return null;
      const fails = Object.keys(e.cards)
        .map(Number)
        .filter((s) => e.cards[s] === 'fail')
        .sort((a, b) => a - b);
      return say(fails.length ? `任务牌：${seatList(fails)}出了失败票。` : '任务牌：全部是成功票。');
    }
    case 'mission_result':
      return say(`第${e.mission}个任务${e.success ? '成功' : '失败'}，失败票${e.fails}张。`);
    case 'assassination_start':
      if (e.declaredBy) return say(`${who(e.declaredBy)}亮明刺客身份，发起提前刺杀！`);
      return say(
        `正义方完成三个任务，进入刺杀阶段。邪恶方亮明身份：` +
          e.evil.map((x) => `${x.seat}号，${ROLE_NAME[x.role]}`).join('；') +
          '。',
      );
    case 'assassination':
      return say(`刺客刺杀了${who(e.target)}，${e.hit ? '刺中梅林！' : `身份是${ROLE_NAME[e.targetRole]}，没有刺中梅林。`}`);
    case 'game_over':
      return say(`${e.winner === 'good' ? '正义方' : '邪恶方'}获胜。${e.reason}`);
    case 'postgame_start':
      return say((e.round ?? 1) > 1 ? `第${e.round}轮赛后交流。` : '赛后交流开始，每人发言一次。');
    default:
      return null;
  }
}

const GAP_MS = 300; // 两条朗读之间的停顿
const RECENT_MS = 30_000; // 打开页面时，这么久以内发生的事件也会朗读

// 只负责把一段段文字读出来
class Speaker {
  private current: { chunks: Segment[]; resolve: () => void } | null = null;
  private utterance: SpeechSynthesisUtterance | null = null; // 保留引用，否则 Chrome 可能回收它导致 onend 不触发
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private voiceCache: SpeechSynthesisVoice[] | null = null;
  blocked = false;
  speakingSeat: number | null = null; // 正在读的这一段属于哪个座位
  rate = 1;

  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  constructor(private onChange: () => void) {}

  // 挂载时调用，返回卸载时的清理函数
  attach(): () => void {
    if (!this.supported) return () => {};
    speechSynthesis.addEventListener('voiceschanged', this.onVoicesChanged);
    window.addEventListener('pointerdown', this.onInteract);
    window.addEventListener('keydown', this.onInteract);
    this.onVoicesChanged();
    return () => {
      this.cancel();
      speechSynthesis.removeEventListener('voiceschanged', this.onVoicesChanged);
      window.removeEventListener('pointerdown', this.onInteract);
      window.removeEventListener('keydown', this.onInteract);
    };
  }

  hasChinese(): boolean {
    return this.supported && this.voices().length > 0;
  }

  // 读完（或被取消）时返回
  say(segments: Segment[]): Promise<void> {
    if (!this.supported) return Promise.resolve();
    this.cancel();
    const chunks = segments.flatMap((s) => splitText(s.text).map((text) => ({ seat: s.seat, text })));
    return new Promise((resolve) => {
      this.current = { chunks, resolve };
      this.speakNext();
    });
  }

  cancel(): void {
    const cur = this.current;
    this.current = null;
    this.utterance = null;
    this.setSpeakingSeat(null);
    clearTimeout(this.watchdog);
    if (this.supported) speechSynthesis.cancel();
    cur?.resolve();
  }

  private onVoicesChanged = () => {
    this.voiceCache = null;
    this.onChange();
  };

  private onInteract = () => {
    if (!this.blocked) return;
    this.blocked = false;
    this.onChange();
    this.speakNext();
  };

  // 可用的中文声音，从好到差：高音质 > 优化音质 > 普通；本机的优先；普通话优先。同一个声音只留最好的版本。
  // 机器味很重的 Eloquence 声音和读普通话不自然的粤语声音，只在没有别的时才用
  private voices(): SpeechSynthesisVoice[] {
    if (this.voiceCache) return this.voiceCache;
    const zh = speechSynthesis.getVoices().filter((v) => /^(zh|cmn|yue)/i.test(v.lang));
    const usable = zh.filter((v) => !ROBOTIC.test(v.name) && !ROBOTIC.test(v.voiceURI) && !/^(yue|zh[-_]HK)/i.test(v.lang));
    const rank = (v: SpeechSynthesisVoice) =>
      (PREMIUM.test(v.name) ? 0 : ENHANCED.test(v.name) ? 2 : 4) +
      (v.localService ? 0 : 6) +
      (/^zh[-_](CN|Hans)/i.test(v.lang) ? 0 : 3);
    const sorted = (usable.length ? usable : zh).sort((a, b) => rank(a) - rank(b));
    const seen = new Set<string>();
    this.voiceCache = sorted.filter((v) => !seen.has(baseName(v)) && !!seen.add(baseName(v)));
    return this.voiceCache;
  }

  // 声音足够多时裁判单独用第一个，玩家轮流用其余的；不够时玩家也轮流用全部声音。
  // shared 表示有别的座位和它用同一个声音，需要靠音调区分
  private voiceFor(seat: number | null): { voice?: SpeechSynthesisVoice; shared: boolean } {
    const voices = this.voices();
    if (seat === null) return { voice: voices[0], shared: false };
    const pool = voices.length > 10 ? voices.slice(1) : voices;
    if (pool.length === 0) return { shared: true };
    return { voice: pool[(seat - 1) % pool.length], shared: pool.length < 10 };
  }

  private setSpeakingSeat(seat: number | null): void {
    if (this.speakingSeat === seat) return;
    this.speakingSeat = seat;
    this.onChange();
  }

  private speakNext(): void {
    const cur = this.current;
    if (!cur || this.blocked) return;
    const chunk = cur.chunks[0];
    if (!chunk) {
      this.current = null;
      this.setSpeakingSeat(null);
      return cur.resolve();
    }
    this.setSpeakingSeat(chunk.seat);

    const u = new SpeechSynthesisUtterance(chunk.text);
    u.lang = 'zh-CN';
    const { voice, shared } = this.voiceFor(chunk.seat);
    if (voice) u.voice = voice;
    const i = chunk.seat !== null && shared ? (chunk.seat - 1) % SEAT_PITCH.length : -1;
    u.pitch = i < 0 ? 1 : SEAT_PITCH[i];
    u.rate = Math.min(4, this.rate * (i < 0 ? 1 : SEAT_RATE[i]));

    const advance = () => {
      if (this.utterance !== u) return;
      this.utterance = null;
      clearTimeout(this.watchdog);
      cur.chunks.shift();
      if (this.current === cur) this.speakNext();
    };
    u.onend = advance;
    u.onerror = (ev) => {
      if (this.utterance !== u) return;
      if (ev.error === 'not-allowed') {
        // 页面还没有过用户交互，等用户点一下再从这一段继续
        this.utterance = null;
        clearTimeout(this.watchdog);
        this.blocked = true;
        this.onChange();
        return;
      }
      advance();
    };
    this.utterance = u;
    // 浏览器偶尔不触发 onend，超过正常时长很多还没结束就跳过这段，免得显示卡住
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(advance, 8000 + (chunk.text.length / (3 * u.rate)) * 1000);
    speechSynthesis.resume(); // Chrome 偶尔会停在暂停状态
    speechSynthesis.speak(u);
  }
}

// 缓冲队列：决定哪些事件已经显示，并按顺序朗读
class Playback {
  private revealed = new Set<number>(); // 已经显示的事件
  private queue: GameEvent[] = []; // 收到了、还没显示的事件
  private queued = new Set<number>();
  private initialized = false; // 连接时推来的历史事件已经收齐（不排队，直接显示）
  private pumping = false;
  private reading: number | null = null;
  private listeners = new Set<() => void>();
  private snapshot: PlaybackState;
  readonly speaker = new Speaker(() => this.changed());
  enabled = false;
  players: PlayerInfo[] = [];
  mySeat: number | null = null;
  godView = false;

  constructor() {
    this.snapshot = this.makeSnapshot();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  // 现在应该显示的事件
  visible(events: GameEvent[]): GameEvent[] {
    if (!this.enabled || !this.initialized) return events;
    return events.filter((e) => this.revealed.has(e.seq));
  }

  // 收到的事件有变化时调用
  sync(events: GameEvent[], synced: boolean, syncedAt: number): void {
    if (!this.initialized) {
      if (!synced) return;
      this.initialized = true;
      // 打开页面时已有的事件直接显示，不读；但刚刚发生的照常排队朗读，
      // 例如新开局时的"游戏开始"和第一次组队，在页面连上之前就已经产生了
      const recentFrom = this.enabled ? syncedAt - RECENT_MS : Infinity;
      for (const e of events) if (e.ts < recentFrom) this.revealed.add(e.seq);
    }
    if (!this.enabled) {
      // 没开朗读时，收到的都直接算已显示
      for (const e of events) this.revealed.add(e.seq);
      return;
    }
    // 重连或对局结束时服务端会重推全部事件，等收齐了再一起处理
    if (!synced) return;
    let maxKnown = 0;
    for (const seq of this.revealed) maxKnown = Math.max(maxKnown, seq);
    for (const seq of this.queued) maxKnown = Math.max(maxKnown, seq);
    const fresh = events.filter((e) => !this.revealed.has(e.seq) && !this.queued.has(e.seq));
    if (fresh.length === 0) return;
    // 序号比已知的还小的，是之前对自己隐藏、现在才能看到的（例如对局结束后其他人的身份），放到最后，
    // 免得在"游戏结束"播报之前就剧透
    const ordered = [...fresh.filter((e) => e.seq > maxKnown), ...fresh.filter((e) => e.seq < maxKnown)];
    for (const e of ordered) {
      this.queue.push(e);
      this.queued.add(e.seq);
    }
    this.changed();
    void this.pump();
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) this.flush();
    this.changed();
  }

  // 停止朗读，把队列里的全部显示出来
  flush(): void {
    for (const e of this.queue) this.revealed.add(e.seq);
    this.queue = [];
    this.queued.clear();
    this.speaker.cancel();
    this.changed();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const e = this.queue.shift()!;
        this.queued.delete(e.seq);
        this.revealed.add(e.seq);
        const segments = narrate(e, this.players, this.mySeat, this.godView);
        this.reading = segments ? e.seq : null;
        this.changed();
        if (!segments) continue;
        await this.speaker.say(segments);
        this.reading = null;
        this.changed();
        if (this.queue.length) await new Promise((r) => setTimeout(r, GAP_MS));
      }
    } finally {
      this.pumping = false;
      this.reading = null;
      this.changed();
    }
  }

  private makeSnapshot(): PlaybackState {
    return {
      supported: this.speaker.supported,
      hasChinese: this.speaker.hasChinese(),
      reading: this.reading,
      speakingSeat: this.speaker.speakingSeat,
      pending: this.queue.filter((e) => narrate(e, this.players, this.mySeat, this.godView)).length,
      caughtUp: !this.enabled || (this.queue.length === 0 && this.reading === null),
      blocked: this.speaker.blocked,
    };
  }

  private changed(): void {
    this.snapshot = this.makeSnapshot();
    for (const fn of this.listeners) fn();
  }
}

// 开启朗读后，返回按朗读进度显示的事件；关闭时就是收到的全部事件
export function usePlayback(
  stream: StreamState,
  enabled: boolean,
  rate: number,
  godView: boolean,
): PlaybackState & { events: GameEvent[]; skipToLatest: () => void } {
  const [playback] = useState(() => new Playback());
  const state = useSyncExternalStore(playback.subscribe, playback.getSnapshot);
  const { events, synced, syncedAt, viewer } = stream;

  playback.players = stream.summary?.players ?? [];
  playback.mySeat = viewer?.kind === 'player' ? viewer.seat : null;
  playback.speaker.rate = rate;
  playback.godView = godView;

  useEffect(() => {
    const detach = playback.speaker.attach();
    return () => {
      detach();
      playback.flush();
    };
  }, [playback]);
  useEffect(() => playback.setEnabled(enabled), [playback, enabled]);
  useEffect(() => playback.sync(events, synced, syncedAt), [playback, events, synced, syncedAt, enabled]);

  // state 每显示一条都会变，用它触发重新过滤
  const visible = useMemo(() => playback.visible(events), [playback, events, state, enabled]);
  // 收到了还没进队列的事件（例如和重推挤在一起到达的），或者重推还没收齐时，也算没追上
  const caughtUp = state.caughtUp && (!enabled || (synced && visible.length === events.length));
  return { ...state, caughtUp, events: visible, skipToLatest: () => playback.flush() };
}

// 朗读追上进度时的值；落后时保持上一次追上时的样子，例如对局状态，免得画面比朗读先知道结果
export function useCaughtUpValue<T>(value: T, caughtUp: boolean): T {
  const last = useRef(value);
  if (caughtUp || last.current === undefined || last.current === null) last.current = value;
  return last.current;
}

const RATE_KEY = 'aivalon.voiceRate';
export const VOICE_RATES = [1, 1.25, 1.5, 2];

export function useVoiceRate(): [number, (r: number) => void] {
  const [rate, setRate] = useState(() => {
    try {
      const r = Number(localStorage.getItem(RATE_KEY));
      return VOICE_RATES.includes(r) ? r : 1.25;
    } catch {
      return 1.25;
    }
  });
  const set = (r: number) => {
    setRate(r);
    try {
      localStorage.setItem(RATE_KEY, String(r));
    } catch {
      // 忽略
    }
  };
  return [rate, set];
}
