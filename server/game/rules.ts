import { ROLE_NAME, ROLE_TEAM, type Role, type RolePreference, type SeatMark } from '../../shared/types.ts';

export { failsRequired } from '../../shared/setup.ts';

export const MAX_ATTEMPTS = 5;

export function isEvil(role: Role): boolean {
  return ROLE_TEAM[role] === 'evil';
}

export function nextSeat(seat: number, players: number): number {
  return (seat % players) + 1;
}

// 从 start 开始顺时针的座位顺序（包含 start）
export function seatsFrom(start: number, players: number): number[] {
  const out: number[] = [];
  let s = start;
  for (let i = 0; i < players; i++) {
    out.push(s);
    s = nextSeat(s, players);
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
  const inGame = (r: Role) => Object.values(roles).includes(r);
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
      const note = inGame('mordred') ? '（莫德雷德对你隐藏，所以邪恶方还有一人你看不到。）' : '（这就是全部邪恶方。）';
      return { text: `你看到的邪恶方玩家是：${seatList(seen)}。${note}`, marks: mark(seen, '邪恶', 'evil') };
    }
    case 'percival': {
      if (!inGame('morgana')) {
        const merlin = seatsWhere((r) => r === 'merlin');
        return {
          text: `你看到梅林是：${seatList(merlin)}。`,
          marks: merlin.map((seat) => ({ seat, label: '梅林', tone: 'good' as const, role: 'merlin' as const })),
        };
      }
      const seen = seatsWhere((r) => r === 'merlin' || r === 'morgana');
      return {
        text: `你看到两位"梅林候选人"：${seatList(seen)}。其中一位是梅林，另一位是伪装成梅林的莫甘娜，你无法直接分辨谁是谁。`,
        marks: mark(seen, '梅林?', 'unknown'),
      };
    }
    case 'loyal':
      return { text: '忠臣在夜晚没有任何信息，只能根据大家的发言、公开的投票记录和任务结果来推理。', marks: [] };
    case 'oberon':
      return {
        text: '你是奥伯伦：你不认识其他邪恶方玩家，他们也不认识你；但梅林看得到你。',
        marks: [],
      };
    case 'assassin':
    case 'morgana':
    case 'mordred':
    case 'minion': {
      // 邪恶方互相认识，但奥伯伦除外
      const mates = seatsWhere((r, s) => isEvil(r) && r !== 'oberon' && s !== seat);
      const note = inGame('oberon') ? '另外本局还有一名奥伯伦，你们互相不认识。' : '';
      return {
        text: `你的邪恶同伴是：${seatList(mates)}（你不知道${mates.length > 1 ? '他们各自' : '他'}的具体身份）。${note}`,
        marks: mark(mates, '同伴', 'evil'),
      };
    }
  }
}

// 按人类玩家的偏好分配身份：先满足指定身份，再满足指定阵营，其余随机。返回每个人类拿到的身份和剩给 AI 的身份
export function assignRoles(setup: Role[], prefs: RolePreference[]): { humans: Role[]; rest: Role[] } {
  const pool = shuffle(setup);
  const humans: (Role | undefined)[] = prefs.map(() => undefined);
  const take = (pred: (r: Role) => boolean): Role | undefined => {
    const i = pool.findIndex(pred);
    return i < 0 ? undefined : pool.splice(i, 1)[0];
  };

  const passes: ((p: RolePreference) => boolean)[] = [
    (p) => p in ROLE_TEAM,
    (p) => p === 'good' || p === 'evil',
    (p) => p === 'random',
  ];
  for (const isPass of passes) {
    prefs.forEach((p, i) => {
      if (!isPass(p)) return;
      const role =
        p === 'random' ? take(() => true) : p === 'good' || p === 'evil' ? take((r) => ROLE_TEAM[r] === p) : take((r) => r === p);
      if (!role) {
        const what = p === 'good' ? '正义方' : p === 'evil' ? '邪恶方' : p === 'random' ? '身份' : ROLE_NAME[p as Role];
        throw new Error(`选择的${what}不够分：请调整人类玩家的身份选择`);
      }
      humans[i] = role;
    });
  }
  return { humans: humans as Role[], rest: pool };
}

export const RULES_TEXT = `
## 阿瓦隆规则

### 阵营与身份
8 人局有 5 名正义方、3 名邪恶方；10 人局有 6 名正义方、4 名邪恶方。本局人数和具体有哪些身份会在开局时公布。可能出现的身份及夜晚信息：
- ${ROLE_NAME.merlin}（正义）：知道邪恶方玩家，但看不到莫德雷德。
- ${ROLE_NAME.percival}（正义）：看得到梅林；如果本局有莫甘娜，会同时看到梅林和莫甘娜，但分不清谁是谁。
- ${ROLE_NAME.loyal}（正义）：没有任何夜晚信息。
- ${ROLE_NAME.assassin}（邪恶）：认识邪恶同伴。正义方完成 3 个任务后，由刺客指定一名玩家刺杀；刺客也可以提前发起刺杀（见"胜负"）。
- ${ROLE_NAME.morgana}（邪恶）：认识邪恶同伴；在派西维尔眼里和梅林一模一样。
- ${ROLE_NAME.mordred}（邪恶）：认识邪恶同伴；梅林看不到他。
- ${ROLE_NAME.oberon}（邪恶）：不认识其他邪恶同伴，其他邪恶同伴也不认识他；但梅林看得到他。
- ${ROLE_NAME.minion}（邪恶）：普通邪恶方，认识邪恶同伴。
邪恶方之间只知道彼此是同伴，不知道对方的具体身份。

### 流程
游戏共 5 个任务，每个任务的出队人数依次为 3、4、4、5、5。
每次组队：
1. 队长先发言，并提名一支队伍（人数必须正好等于本任务要求，队长可以选自己，也可以不选）。
2. 其余玩家从队长的下一位开始，按座位顺序依次发言一次。
3. 队长听完后再次发言，确认或修改队伍，作为最终提名。
4. 全体玩家同时投票赞成或反对这支队伍。每人的投票结果会公开。
   - 超过半数（8 人局至少 5 票，10 人局至少 6 票）赞成则组队成功，否则组队失败，队长交给下一位玩家，重新组队。
   - 同一个任务连续 5 次组队失败，邪恶方直接获胜。
5. 组队成功后，队员秘密出任务牌：正义方只能出"成功"，邪恶方可以选择"成功"或"失败"。
   - 只公布失败票的数量，不公布是谁出的。
   - 有 1 张失败票，任务就失败；但第 4 个任务需要至少 2 张失败票才会失败。
6. 无论组队是否成功，每次组队后队长都按座位顺序交给下一位玩家。

### 胜负
- 3 个任务失败：邪恶方获胜。
- 同一个任务连续 5 次组队失败：邪恶方获胜。
- 3 个任务成功：进入刺杀阶段。邪恶方玩家公开身份并公开讨论，最后由刺客指定一名玩家刺杀。刺中梅林则邪恶方获胜，否则正义方获胜。刺杀阶段正义方不能发言。
- 提前刺杀：在组队和任务阶段，刺客轮到自己行动时（提名、发言、最终提名、投票、出任务牌），可以不做这个动作，改为亮明刺客身份并直接指定一名玩家刺杀。当前的组队和任务作废，不进行讨论，立即结算：刺中梅林则邪恶方获胜，否则正义方获胜。
`.trim();
