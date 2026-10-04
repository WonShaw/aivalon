import type { Role } from './types.ts';

// 8 人局的配置，前后端共用
export const PLAYER_COUNT = 8;

// 5 好 3 坏
export const ROLES: Role[] = ['merlin', 'percival', 'loyal', 'loyal', 'loyal', 'assassin', 'morgana', 'mordred'];

// 每个任务的队伍人数
export const TEAM_SIZES = [3, 4, 4, 5, 5];

// 各身份在夜晚能看到什么（给玩家看的说明）
export const ROLE_SIGHT: Record<Role, string> = {
  merlin: '看得到邪恶方，但看不到莫德雷德',
  percival: '看得到梅林和莫甘娜，但分不清谁是谁',
  loyal: '没有夜晚信息',
  assassin: '认识邪恶同伴；游戏最后由他刺杀梅林',
  morgana: '认识邪恶同伴；在派西维尔眼里像梅林',
  mordred: '认识邪恶同伴；梅林看不到他',
};
