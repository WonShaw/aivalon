import { ROLE_NAME, ROLE_TEAM, type Role, type Team } from './types.ts';

// 支持的人数及对应的配置（官方规则），前后端共用
export const PLAYER_COUNTS = [8, 10];

const TEAM_COUNTS: Record<number, Record<Team, number>> = {
  8: { good: 5, evil: 3 },
  10: { good: 6, evil: 4 },
};

// 每个任务的队伍人数
const TEAM_SIZES: Record<number, number[]> = {
  8: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

export function teamCount(players: number): Record<Team, number> {
  return TEAM_COUNTS[players];
}

export function teamSizes(players: number): number[] {
  return TEAM_SIZES[players];
}

// 第 4 个任务需要 2 张失败票才算失败（7 人及以上，目前支持的人数都满足）
export function failsRequired(mission: number): number {
  return mission === 4 ? 2 : 1;
}

// 可选的特殊身份：派西维尔顶替一个忠臣；邪恶方除刺客外的位置可以选这些，空位由爪牙补上
export const OPTIONAL_EVIL: Role[] = ['morgana', 'mordred', 'oberon'];

export function maxEvilSpecials(players: number): number {
  return Math.min(OPTIONAL_EVIL.length, TEAM_COUNTS[players].evil - 1);
}

export interface SetupOptions {
  players: number;
  percival: boolean;
  evil: Role[]; // OPTIONAL_EVIL 中的若干个
}

export function buildSetup(o: SetupOptions): Role[] {
  const counts = TEAM_COUNTS[o.players];
  const good: Role[] = ['merlin', ...(o.percival ? (['percival'] as Role[]) : [])];
  while (good.length < counts.good) good.push('loyal');
  const evil: Role[] = ['assassin', ...OPTIONAL_EVIL.filter((r) => o.evil.includes(r))];
  while (evil.length < counts.evil) evil.push('minion');
  return [...good, ...evil];
}

export interface Preset {
  name: string;
  description: string;
  options: SetupOptions;
}

export const PRESETS: Record<number, Preset[]> = {
  8: [
    {
      name: '标准',
      description: '派西维尔要分辨真假梅林，梅林看不到莫德雷德',
      options: { players: 8, percival: true, evil: ['morgana', 'mordred'] },
    },
    {
      name: '奥伯伦',
      description: '奥伯伦和其他坏人互不相识，但梅林看得到他',
      options: { players: 8, percival: true, evil: ['morgana', 'oberon'] },
    },
    {
      name: '入门',
      description: '只有梅林和刺客两个特殊身份',
      options: { players: 8, percival: false, evil: [] },
    },
  ],
  10: [
    {
      name: '标准',
      description: '莫甘娜、莫德雷德、奥伯伦全部登场',
      options: { players: 10, percival: true, evil: ['morgana', 'mordred', 'oberon'] },
    },
    {
      name: '不含奥伯伦',
      description: '第四个坏人是普通爪牙，坏人之间全部互相认识',
      options: { players: 10, percival: true, evil: ['morgana', 'mordred'] },
    },
    {
      name: '入门',
      description: '只有梅林和刺客两个特殊身份',
      options: { players: 10, percival: false, evil: [] },
    },
  ],
};

export const STANDARD_SETUP = buildSetup(PRESETS[8][0].options);

export function setupOptionsOf(setup: Role[]): SetupOptions {
  return {
    players: setup.length,
    percival: setup.includes('percival'),
    evil: OPTIONAL_EVIL.filter((r) => setup.includes(r)),
  };
}

// 检查一套配置是否合法；返回错误信息或 null
export function validateSetup(setup: unknown): string | null {
  if (!Array.isArray(setup) || !PLAYER_COUNTS.includes(setup.length)) {
    return `人数必须是 ${PLAYER_COUNTS.join(' 或 ')} 人`;
  }
  if (setup.some((r) => !(r in ROLE_TEAM))) return '身份配置里有未知身份';
  const roles = setup as Role[];
  const opts = setupOptionsOf(roles);
  const counts = TEAM_COUNTS[opts.players];
  const expected = buildSetup(opts);
  const key = (rs: Role[]) => [...rs].sort().join(',');
  if (key(expected) !== key(roles)) {
    return `身份配置不合法：需要梅林和刺客，${counts.good} 名正义方、${counts.evil} 名邪恶方，特殊身份各最多 1 个`;
  }
  return null;
}

export function countRoles(setup: Role[]): [Role, number][] {
  const counts = new Map<Role, number>();
  for (const r of setup) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()];
}

export function describeSetup(setup: Role[]): string {
  const part = (team: Team) =>
    countRoles(setup)
      .filter(([r]) => ROLE_TEAM[r] === team)
      .map(([r, n]) => (n > 1 ? `${ROLE_NAME[r]}×${n}` : ROLE_NAME[r]))
      .join('、');
  return `${setup.length} 人局 · 正义方：${part('good')}；邪恶方：${part('evil')}`;
}

// 某个身份在这套配置下夜晚能看到什么（给玩家看的说明）
export function roleSight(role: Role, setup: Role[]): string {
  const has = (r: Role) => setup.includes(r);
  const mates = has('oberon') ? '认识除奥伯伦外的邪恶同伴' : '认识邪恶同伴';
  switch (role) {
    case 'merlin':
      return has('mordred') ? '看得到邪恶方，但看不到莫德雷德' : '看得到全部邪恶方';
    case 'percival':
      return has('morgana') ? '看得到梅林和莫甘娜，但分不清谁是谁' : '看得到梅林';
    case 'loyal':
      return '没有夜晚信息';
    case 'assassin':
      return `${mates}；游戏最后由他刺杀梅林`;
    case 'morgana':
      return has('percival') ? `${mates}；在派西维尔眼里像梅林` : mates;
    case 'mordred':
      return `${mates}；梅林看不到他`;
    case 'oberon':
      return '和其他邪恶方互不相识；梅林看得到他';
    case 'minion':
      return `${mates}，没有其他能力`;
  }
}
