import { ROLE_NAME, ROLE_TEAM, type ActionType, type PlayerInfo, type Role } from '../shared/types.ts';

export function playerName(players: PlayerInfo[], seat: number): string {
  return players.find((p) => p.seat === seat)?.name ?? `${seat}号`;
}

export function roleLabel(role: Role): string {
  return ROLE_NAME[role];
}

export function roleTone(role: Role): 'good' | 'evil' {
  return ROLE_TEAM[role];
}

export const ACTION_LABEL: Record<ActionType, string> = {
  propose: '提名',
  speak: '发言',
  final_team: '确认队伍',
  vote: '投票',
  mission: '出任务牌',
  evil_discuss: '刺杀讨论',
  assassinate: '刺杀',
  reflect: '赛后感想',
};

// 每个座位一个固定色相，用于头像
export function seatHue(seat: number): number {
  return [32, 200, 140, 280, 350, 90, 240, 170, 55, 315][(seat - 1) % 10];
}
