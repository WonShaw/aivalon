// 前后端共享的类型定义

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

export type SpeechKind = 'propose' | 'discuss' | 'final' | 'assassin_discuss' | 'assassinate' | 'reflect';

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
  | { type: 'speech'; seat: number; kind: SpeechKind; text: string }
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
  // evil：亮明身份的邪恶方。刺客提前发起刺杀时（declaredBy 是刺客的座位）只亮明刺客
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
  | { type: 'ai_error'; seat: number; action: ActionType; message: string }
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
  | 'reflect';

export type GameStatus = 'running' | 'finished' | 'aborted' | 'error';

// 赛后交流的状态：还没开始 / 进行中 / 已结束（每局只能开一次）
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
}

// 谁在看：全 AI 对局的上帝视角观众，或者某个座位上的人类玩家
export type Viewer = { kind: 'spectator' } | { kind: 'player'; seat: number };

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
}

export interface CreateGameRequest {
  humans: HumanSeatRequest[]; // 空数组表示全 AI 对局
  setup: Role[]; // 8 个身份
}

export interface CreateGameResponse {
  summary: GameSummary;
  seats: { seat: number; name: string; token: string }[]; // 每个人类玩家的专属凭证
}

// 通过 SSE 推给前端的消息
export type StreamMessage =
  | { kind: 'hello'; viewer: Viewer }
  | { kind: 'event'; event: GameEvent }
  | { kind: 'live'; seat: number; action: ActionType; speech: string } // 正在生成中的发言（流式）
  | { kind: 'status'; seat: number; action: ActionType; active: boolean } // 谁正在行动
  | { kind: 'game'; summary: GameSummary }
  | { kind: 'request'; request: HumanRequest } // 轮到你了
  | { kind: 'request_done'; seat: number; id: string };
