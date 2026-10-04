import { ROLE_NAME, ROLE_TEAM, type Role, type SeatMark, type Team } from '../../shared/types.ts';
import { PLAYER_COUNT, ROLES, ROLE_SIGHT } from '../../shared/setup.ts';
import { guessTeam, type Guess } from '../guesses.ts';

interface Props {
  roles: Record<number, Role>; // 当前观看者能看到的身份
  nightMarks: SeatMark[];
  guesses: Record<number, Guess>;
  canMark: boolean;
}

const ROLE_ORDER: Role[] = ['merlin', 'percival', 'loyal', 'assassin', 'morgana', 'mordred'];

// 本局身份配置，以及按"已知 + 你的标记"统计出的每种身份已经对上了几个
export function RoleGuide({ roles, nightMarks, guesses, canMark }: Props) {
  const total = (r: Role) => ROLES.filter((x) => x === r).length;
  const teamTotal = (t: Team) => ROLES.filter((x) => ROLE_TEAM[x] === t).length;

  const roleCount: Partial<Record<Role, number>> = {};
  const teamCount: Record<Team, number> = { good: 0, evil: 0 };
  const evilMarks = new Set(nightMarks.filter((m) => m.tone === 'evil').map((m) => m.seat));
  for (let seat = 1; seat <= PLAYER_COUNT; seat++) {
    const known = roles[seat];
    const guess = guesses[seat];
    const role = known ?? (guess && guess !== 'good' && guess !== 'evil' ? guess : undefined);
    if (role) roleCount[role] = (roleCount[role] ?? 0) + 1;
    const team = known ? ROLE_TEAM[known] : guess ? guessTeam(guess) : evilMarks.has(seat) ? 'evil' : undefined;
    if (team) teamCount[team]++;
  }

  const teamBlock = (team: Team, label: string) => (
    <div className={`guide-team ${team}`}>
      <div className="guide-team-head">
        {label} {teamTotal(team)} 人
        <span className={`guide-count${teamCount[team] > teamTotal(team) ? ' over' : ''}`}>
          已判断 {teamCount[team]}/{teamTotal(team)}
        </span>
      </div>
      <div className="guide-roles">
        {ROLE_ORDER.filter((r) => ROLE_TEAM[r] === team).map((r) => {
          const n = roleCount[r] ?? 0;
          return (
            <span key={r} className={`guide-role ${team}`} title={ROLE_SIGHT[r]}>
              {ROLE_NAME[r]} ×{total(r)}
              {n > 0 && <span className={`guide-count${n > total(r) ? ' over' : ''}`}>已对上 {n}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="guide">
      <div className="guide-title">本局身份</div>
      {teamBlock('good', '正义方')}
      {teamBlock('evil', '邪恶方')}
      <details className="guide-sight">
        <summary>各身份在夜晚能看到什么</summary>
        <ul>
          {ROLE_ORDER.map((r) => (
            <li key={r}>
              <b>{ROLE_NAME[r]}</b>：{ROLE_SIGHT[r]}
            </li>
          ))}
        </ul>
      </details>
      {canMark && <div className="muted small-text">点击圆桌上的座位，可以标记你对他身份的猜测。</div>}
    </div>
  );
}
