import type { GameEvent, Role, SeatMark, Team, Viewer } from '../shared/types.ts';

export interface BoardState {
  mission: number; // 当前任务（1-5）
  attempt: number;
  leader: number | null;
  teamSize: number | null;
  proposedTeam: number[]; // 当前提名（未投票前）
  lastVote: { votes: Record<number, 'approve' | 'reject'>; approved: boolean } | null;
  missionResults: ({ success: boolean; fails: number } | null)[];
  knownRoles: Record<number, Role>; // 当前观看者收到的全部身份信息（观众是所有人的）
  publicRoles: Record<number, Role>; // 已公开的身份（刺杀阶段的邪恶方、结束后的全部）
  myRole: { role: Role; knowledge: string; marks: SeatMark[] } | null;
  gameOver: { winner: Team; reason: string } | null;
  usage: { costUsd: number; calls: number; cacheRead: number; cacheWrite: number; input: number; output: number };
}

export function deriveBoard(events: GameEvent[], viewer: Viewer | null): BoardState {
  const s: BoardState = {
    mission: 1,
    attempt: 1,
    leader: null,
    teamSize: null,
    proposedTeam: [],
    lastVote: null,
    missionResults: [null, null, null, null, null],
    knownRoles: {},
    publicRoles: {},
    myRole: null,
    gameOver: null,
    usage: { costUsd: 0, calls: 0, cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  };

  const sessionCost: Record<number, number> = {}; // 每个 AI 会话上一次报告的累计费用

  for (const e of events) {
    switch (e.type) {
      case 'game_start':
        s.leader = e.firstLeader;
        break;
      case 'role_assigned':
        // 能看到全部信息的人会收到所有人的这一条；对局中的玩家只会收到自己的
        s.knownRoles[e.seat] = e.role;
        if (viewer?.kind === 'player' && viewer.seat === e.seat) s.myRole = { role: e.role, knowledge: e.knowledge, marks: e.marks };
        break;
      case 'round_start':
        s.mission = e.mission;
        s.attempt = e.attempt;
        s.leader = e.leader;
        s.teamSize = e.teamSize;
        s.proposedTeam = [];
        s.lastVote = null;
        break;
      case 'team_proposed':
        s.proposedTeam = e.team;
        break;
      case 'team_vote':
        s.lastVote = { votes: e.votes, approved: e.approved };
        break;
      case 'mission_result':
        s.missionResults[e.mission - 1] = { success: e.success, fails: e.fails };
        break;
      case 'assassination_start':
        for (const x of e.evil) s.knownRoles[x.seat] = s.publicRoles[x.seat] = x.role;
        // 刺杀阶段不再显示提名和投票（提前刺杀时当前的组队作废）
        s.proposedTeam = [];
        s.lastVote = null;
        break;
      case 'game_over':
        s.gameOver = { winner: e.winner, reason: e.reason };
        Object.assign(s.knownRoles, e.roles);
        Object.assign(s.publicRoles, e.roles);
        break;
      case 'ai_usage': {
        // costUsd 是会话的累计值，这次调用的费用是和上一次的差值；变小说明累计值被重置了，按新值算
        const prev = sessionCost[e.seat] ?? 0;
        s.usage.costUsd += e.costUsd >= prev ? e.costUsd - prev : e.costUsd;
        sessionCost[e.seat] = e.costUsd;
        s.usage.calls += 1;
        s.usage.cacheRead += e.cacheRead;
        s.usage.cacheWrite += e.cacheWrite;
        s.usage.input += e.input;
        s.usage.output += e.output;
        break;
      }
    }
  }
  return s;
}

// 对局中玩家收到的身份本来就只有自己的和已公开的；能看到全部信息的人关掉上帝视角时只看已公开的
// （对局结束后所有身份都已公开，两者一样）
export function visibleRoles(board: BoardState, viewer: Viewer | null, godView: boolean): Record<number, Role> {
  return viewer?.kind === 'player' || godView ? board.knownRoles : board.publicRoles;
}
