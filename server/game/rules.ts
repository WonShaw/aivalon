import { ROLE_NAME, ROLE_TEAM, type Role, type SeatMark } from '../../shared/types.ts';

import { PLAYER_COUNT } from '../../shared/setup.ts';

export { PLAYER_COUNT, ROLES, TEAM_SIZES } from '../../shared/setup.ts';

// 第 4 个任务需要 2 张失败票才算失败（7 人及以上）
export function failsRequired(mission: number): number {
  return mission === 4 ? 2 : 1;
}

export const MAX_ATTEMPTS = 5;

export function isEvil(role: Role): boolean {
  return ROLE_TEAM[role] === 'evil';
}

export function nextSeat(seat: number): number {
  return (seat % PLAYER_COUNT) + 1;
}

// 从 start 开始顺时针的座位顺序（包含 start）
export function seatsFrom(start: number): number[] {
  const out: number[] = [];
  let s = start;
  for (let i = 0; i < PLAYER_COUNT; i++) {
    out.push(s);
    s = nextSeat(s);
  }
  return out;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function seatList(seats: number[]): string {
  return seats.map((s) => `${s}号`).join('、');
}

// 每个身份在夜晚阶段获得的私密信息：给 AI 的文字说明，以及给前端的座位标记
export function knowledgeFor(seat: number, roles: Record<number, Role>): { text: string; marks: SeatMark[] } {
  const role = roles[seat];
  const seatsWhere = (pred: (r: Role, s: number) => boolean) =>
    Object.entries(roles)
      .map(([s, r]) => [Number(s), r] as const)
      .filter(([s, r]) => pred(r, s))
      .map(([s]) => s)
      .sort((a, b) => a - b);
  const mark = (list: number[], label: string, tone: SeatMark['tone']) => list.map((s) => ({ seat: s, label, tone }));

  switch (role) {
    case 'merlin': {
      const seen = seatsWhere((r) => isEvil(r) && r !== 'mordred');
      return {
        text: `你看到的邪恶方玩家是：${seatList(seen)}。（莫德雷德对你隐藏，所以邪恶方还有一人你看不到。）`,
        marks: mark(seen, '邪恶', 'evil'),
      };
    }
    case 'percival': {
      const seen = seatsWhere((r) => r === 'merlin' || r === 'morgana');
      return {
        text: `你看到两位"梅林候选人"：${seatList(seen)}。其中一位是梅林，另一位是伪装成梅林的莫甘娜，你无法直接分辨谁是谁。`,
        marks: mark(seen, '梅林?', 'unknown'),
      };
    }
    case 'loyal':
      return { text: '忠臣在夜晚没有任何信息，只能根据大家的发言、公开的投票记录和任务结果来推理。', marks: [] };
    case 'assassin':
    case 'morgana':
    case 'mordred': {
      const mates = seatsWhere((r, s) => isEvil(r) && s !== seat);
      return {
        text: `你的邪恶同伴是：${seatList(mates)}（你不知道他们各自的具体身份）。`,
        marks: mark(mates, '同伴', 'evil'),
      };
    }
  }
}

export const RULES_TEXT = `
## 阿瓦隆规则（8 人局）

### 阵营与身份
- 正义方 5 人：${ROLE_NAME.merlin}、${ROLE_NAME.percival}、${ROLE_NAME.loyal} ×3
- 邪恶方 3 人：${ROLE_NAME.assassin}、${ROLE_NAME.morgana}、${ROLE_NAME.mordred}

### 夜晚信息
- 梅林：知道邪恶方玩家，但看不到莫德雷德。
- 派西维尔：看到梅林和莫甘娜两人，但不知道哪个是梅林。
- 邪恶方（刺客、莫甘娜、莫德雷德）：互相知道彼此是同伴，但不知道对方的具体身份。
- 亚瑟的忠臣：没有任何信息。

### 流程
游戏共 5 个任务，每个任务的出队人数依次为 3、4、4、5、5。
每次组队：
1. 队长先发言，并提名一支队伍（人数必须正好等于本任务要求，队长可以选自己，也可以不选）。
2. 其余玩家从队长的下一位开始，按座位顺序依次发言一次。
3. 队长听完后再次发言，确认或修改队伍，作为最终提名。
4. 全体玩家同时投票赞成或反对这支队伍。每人的投票结果会公开。
   - 超过半数（至少 5 票）赞成则组队成功，否则组队失败，队长交给下一位玩家，重新组队。
   - 同一个任务连续 5 次组队失败，邪恶方直接获胜。
5. 组队成功后，队员秘密出任务牌：正义方只能出"成功"，邪恶方可以选择"成功"或"失败"。
   - 只公布失败票的数量，不公布是谁出的。
   - 有 1 张失败票，任务就失败；但第 4 个任务需要至少 2 张失败票才会失败。
6. 无论组队是否成功，每次组队后队长都按座位顺序交给下一位玩家。

### 胜负
- 3 个任务失败：邪恶方获胜。
- 3 个任务成功：进入刺杀阶段。邪恶方玩家公开身份并公开讨论，最后由刺客指定一名玩家刺杀。刺中梅林则邪恶方获胜，否则正义方获胜。刺杀阶段正义方不能发言。
`.trim();
