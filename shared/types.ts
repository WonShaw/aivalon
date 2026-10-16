// 前后端共享的类型定义
import type { AIConfig } from './ai.ts';

export type Role =
  | 'merlin'
  | 'percival'
  | 'loyal'
  | 'assassin'
  | 'morgana'
  | 'mordred'
  | 'oberon'
  | 'minion';

export type Team = 'good' | 'evil';

export const ROLE_TEAM: Record<Role, Team> = {
  merlin: 'good',
  percival: 'good',
  loyal: 'good',
  assassin: 'evil',
  morgana: 'evil',
  mordred: 'evil',
  oberon: 'evil',
  minion: 'evil',
};

export const ROLE_NAME: Record<Role, string> = {
  merlin: '梅林',
  percival: '派西维尔',
  loyal: '亚瑟的忠臣',
  assassin: '刺客',
  morgana: '莫甘娜',
  mordred: '莫德雷德',
  oberon: '奥伯伦',
  minion: '莫德雷德的爪牙',
};

export interface PlayerInfo {
  seat: number; // 1-8
  name: string;
  kind: 'ai' | 'human';
  avatar?: string; // 像素头像的 id（见 shared/avatars.ts）。早期的记录没有
}

// 夜晚信息在座位上的标记，例如梅林看到的邪恶方、派西维尔看到的梅林候选人
export interface SeatMark {
  seat: number;
  label: string;
  tone: 'good' | 'evil' | 'unknown';
  role?: Role; // 能确定具体身份时才有，例如没有莫甘娜时派西维尔看到的梅林
}

export type Visibility =
  | { kind: 'public' }
  | { kind: 'players'; seats: number[] }
  | { kind: 'spectator' };

export type SpeechKind = 'propose' | 'discuss' | 'final' | 'assassin_discuss' | 'assassinate' | 'reflect' | 'chat';

export type GameEventBody =
  | { type: 'game_start'; players: PlayerInfo[]; firstLeader: number; setup: Role[] }
  | { type: 'role_assigned'; seat: number; role: Role; knowledge: string; marks: SeatMark[] }
  | {
      type: 'round_start';
      mission: number; // 1-5
      attempt: number; // 1-5
      leader: number;
      teamSize: number;
      failsRequired: number;
    }
  // to：赛后单独对话（kind=chat）时说话的对象
  | { type: 'speech'; seat: number; kind: SpeechKind; text: string; to?: number }
  | { type: 'team_proposed'; leader: number; team: number[]; final: boolean }
  | {
      type: 'team_vote';
      mission: number;
      attempt: number;
      team: number[];
      votes: Record<number, 'approve' | 'reject'>;
      approved: boolean;
    }
  | { type: 'mission_cards'; mission: number; cards: Record<number, 'success' | 'fail'> }
  | { type: 'mission_result'; mission: number; team: number[]; fails: number; success: boolean }
  // evil：亮明身份的邪恶方。declaredBy：刺客提前发起刺杀时是刺客的座位
  | { type: 'assassination_start'; evil: { seat: number; role: Role }[]; declaredBy?: number }
  | { type: 'assassination'; assassin: number; target: number; targetRole: Role; hit: boolean }
  | {
      type: 'game_over';
      winner: Team;
      reason: string;
      roles: Record<number, Role>;
    }
  // 赛后交流：游戏结束后由玩家手动开启，每轮每人发言一次，可以开多轮。旧记录里没有 round，视为第 1 轮
  | { type: 'postgame_start'; round?: number }
  | { type: 'postgame_end' }
  // 以下仅观众可见
  | { type: 'thought'; seat: number; action: ActionType; summary: string }
  // 调试模式下以裁判身份向某个 AI 提问：在从它的游戏会话 fork 出来的临时会话里回答，不进入游戏，其他 AI 看不到。
  // forked：这次是新 fork 的（第一次问，或者它在游戏里又行动过），否则接着上一次的调试对话
  | { type: 'debug_ask'; id: string; seat: number; question: string }
  | { type: 'debug_answer'; id: string; seat: number; answer?: string; thinking?: string; error?: string; forked?: boolean }
  | { type: 'ai_error'; seat: number; action: ActionType; message: string }
  // costUsd 是这个 AI 的会话到这次调用为止的累计估算费用（SDK 续接会话时会带上之前的轮次），
  // 不是这一次的费用；token 数是这一次调用的
  | { type: 'ai_usage'; seat: number; action: ActionType; costUsd: number; durationMs: number; cacheRead: number; cacheWrite: number; input: number; output: number };

export type GameEvent = GameEventBody & {
  seq: number;
  ts: number;
  visibility: Visibility;
};

export type ActionType =
  | 'propose'
  | 'speak'
  | 'final_team'
  | 'vote'
  | 'mission'
  | 'evil_discuss'
  | 'assassinate'
  | 'reflect'
  | 'chat';

export type GameStatus = 'running' | 'finished' | 'aborted' | 'error';

// 赛后交流的状态：还没开始 / 进行中（一轮发言或一次单独对话） / 已结束（可以再开）
export type PostgameStatus = 'none' | 'running' | 'done';

export interface GameSummary {
  id: string;
  createdAt: number;
  status: GameStatus;
  winner?: Team;
  players: PlayerInfo[];
  hasHumans: boolean;
  setup: Role[]; // 本局的身份配置（不含谁是谁）
  postgame: PostgameStatus;
  ai?: AIConfig; // AI 玩家的模型和推理强度（早期的记录没有）
  debug: boolean; // 调试模式：本局所有人都能看到全部身份和 AI 的思考，可以暂停、以裁判身份向 AI 提问
  paused: boolean; // 调试模式下暂停了：已经发起的 AI 调用照常完成，新的调用等继续后再发起
}

// 谁在看：全 AI 对局的上帝视角观众，或者某个座位上的人类玩家
export type Viewer = { kind: 'spectator' } | { kind: 'player'; seat: number };

// 能看到全部信息（所有人的身份、任务牌、AI 的思考摘要和调用统计）：全 AI 对局的观众一直可以，
// 玩家在对局正常结束后、或者本局开了调试模式时也可以。服务端据此过滤推送，网页据此显示对应的开关和面板。
// 只影响推给网页的内容，AI 的上下文由 engine.ts 的 visibleTo 单独过滤
export function seesEverything(viewer: Viewer, status: GameStatus, debug = false): boolean {
  return viewer.kind === 'spectator' || status === 'finished' || debug;
}

// 等待人类玩家做的动作
export interface HumanRequest {
  id: string;
  seat: number;
  action: ActionType;
  mission?: number;
  attempt?: number;
  leader?: number;
  teamSize?: number;
  team?: number[];
  canFail?: boolean; // 任务牌：只有邪恶方可以出失败
  targets?: number[]; // 刺杀：可选目标
  canAssassinate?: boolean; // 刺客可以不做这个动作，改为发起提前刺杀
}

// 人类玩家提交的动作，字段与 AI 的结构化输出一致
export interface ActionSubmission {
  action: ActionType;
  speech?: string;
  team?: number[];
  vote?: 'approve' | 'reject';
  mission_card?: 'success' | 'fail';
  target?: number;
}

// 人类玩家想玩的身份：随机、随机某个阵营，或指定身份
export type RolePreference = 'random' | Team | Role;

export interface HumanSeatRequest {
  name: string;
  role: RolePreference;
  avatar?: string; // 不填用默认头像
}

export interface CreateGameRequest {
  humans: HumanSeatRequest[]; // 空数组表示全 AI 对局
  setup: Role[]; // 8 个身份
  ai?: AIConfig; // 不填用默认配置
}

export interface CreateGameResponse {
  summary: GameSummary;
  seats: { seat: number; name: string; token: string }[]; // 每个人类玩家的专属凭证
}

// 通过 SSE 推给前端的消息
export type StreamMessage =
  | { kind: 'hello'; viewer: Viewer }
  | { kind: 'synced'; now: number } // 当前状态已推送完（跟在 hello 之后），之后收到的都是新发生的。now 是服务端此刻的时间
  | { kind: 'event'; event: GameEvent }
  | { kind: 'live'; seat: number; action: ActionType; speech: string } // 正在生成中的发言（流式）
  | { kind: 'status'; seat: number; action: ActionType; active: boolean } // 谁正在行动
  | { kind: 'game'; summary: GameSummary }
  | { kind: 'request'; request: HumanRequest } // 轮到你了
  | { kind: 'request_done'; seat: number; id: string };
