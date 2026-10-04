import { useState } from 'react';
import type { ActionType, PlayerInfo, Role, SeatMark, Viewer } from '../../shared/types.ts';
import { teamSizes } from '../../shared/setup.ts';
import type { BoardState } from '../derive.ts';
import { ACTION_LABEL, roleLabel, roleTone, seatHue } from '../format.ts';
import { guessLabel, guessOptions, guessTeam, type Guess } from '../guesses.ts';

interface Props {
  setup: Role[];
  players: PlayerInfo[];
  board: BoardState;
  acting: Record<number, ActionType>;
  viewer: Viewer | null;
  roles: Record<number, Role>; // 当前观看者能看到的身份
  guesses: Record<number, Guess>;
  onGuess: (seat: number, guess: Guess | null) => void;
}

export function RoundTable({ setup, players, board, acting, viewer, roles, guesses, onGuess }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const mySeat = viewer?.kind === 'player' ? viewer.seat : null;
  const marks: Record<number, SeatMark> = {};
  for (const m of board.myRole?.marks ?? []) marks[m.seat] = m;

  // 自己和已经能看到身份的座位不需要标记
  const canGuess = (seat: number) => seat !== mySeat && !roles[seat];
  const selectedPlayer = selected !== null && canGuess(selected) ? players.find((p) => p.seat === selected) : undefined;

  return (
    <div className={`table-wrap seats-${players.length}`}>
      <div className="table">
        <div className="table-center">
          <div className="table-title">{board.gameOver ? '游戏结束' : `第 ${board.mission} 个任务`}</div>
          <div className="missions">
            {teamSizes(players.length).map((size, i) => {
              const r = board.missionResults[i];
              const cls = r
                ? r.success
                  ? 'mission ok'
                  : 'mission bad'
                : i + 1 === board.mission && !board.gameOver
                  ? 'mission current'
                  : 'mission';
              return (
                <div key={i} className={cls} title={r ? `失败票 ${r.fails} 张` : `需要 ${size} 人`}>
                  <span className="mission-size">{size}</span>
                  {i === 3 && <span className="mission-note">2败</span>}
                </div>
              );
            })}
          </div>
          <div className="attempts" title="本任务的组队次数，第 5 次仍被否决则邪恶方获胜">
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className={n < board.attempt ? 'attempt-dot used' : n === board.attempt ? 'attempt-dot now' : 'attempt-dot'}
              />
            ))}
            <span className="attempts-label">组队 {board.attempt}/5</span>
          </div>
        </div>

        {players.map((p) => {
          const angle = (-90 + ((p.seat - 1) * 360) / players.length) * (Math.PI / 180);
          const style = {
            left: `${50 + 39 * Math.cos(angle)}%`,
            top: `${50 + 40 * Math.sin(angle)}%`,
            '--hue': seatHue(p.seat),
          } as React.CSSProperties;
          const role = roles[p.seat];
          const vote = board.lastVote?.votes[p.seat];
          const act = acting[p.seat];
          const mark = marks[p.seat];
          const guess = guesses[p.seat];
          const guessable = canGuess(p.seat);
          const classes = ['seat'];
          if (act) classes.push('acting');
          if (board.proposedTeam.includes(p.seat)) classes.push('in-team');
          if (p.seat === mySeat) classes.push('me');
          if (guessable) classes.push('guessable');
          if (selected === p.seat) classes.push('selected');

          return (
            <div
              key={p.seat}
              className={classes.join(' ')}
              style={style}
              onClick={guessable ? () => setSelected(selected === p.seat ? null : p.seat) : undefined}
              title={guessable ? '点击标记你对他身份的猜测' : undefined}
            >
              <div className="avatar-wrap">
                <div className="avatar">{p.seat}</div>
                {board.leader === p.seat && !board.gameOver && (
                  <span className="crown" title="队长">
                    ♛
                  </span>
                )}
                {board.proposedTeam.includes(p.seat) && (
                  <span className="team-mark" title="在本轮提名的队伍里">
                    ⚔
                  </span>
                )}
                {vote && (
                  <span className={`vote-dot ${vote}`} title={vote === 'approve' ? '赞成' : '反对'}>
                    {vote === 'approve' ? '✓' : '✗'}
                  </span>
                )}
              </div>
              <div className="seat-name">{p.name}</div>
              <div className={`seat-sub${act ? ' acting-text' : ''}`}>
                {act
                  ? `${p.kind === 'human' ? '等待' : '思考'}·${ACTION_LABEL[act]}`
                  : p.seat === mySeat
                    ? '你'
                    : p.kind === 'human'
                      ? '人类'
                      : p.persona}
              </div>
              <div className="seat-badges">
                {/* 每个座位最多一个标记：已知身份 > 自己的猜测 > 夜晚信息（有猜测时夜晚信息放进悬停提示） */}
                {role && <span className={`badge ${roleTone(role)}`}>{roleLabel(role)}</span>}
                {!role && guess && (
                  <span className={`badge guess ${guessTeam(guess)}`} title={mark ? `夜晚信息：${mark.label}` : undefined}>
                    {guessLabel(guess)}?
                  </span>
                )}
                {!role && !guess && mark && <span className={`badge ${mark.tone}`}>{mark.label}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="table-legend">
        <span>
          <span className="legend-crown">♛</span>队长
        </span>
        <span>
          <span className="legend-ring" />⚔ 提名的队伍
        </span>
        <span>
          <span className="legend-acting" />正在行动
        </span>
        <span>✓ ✗ 上一次投票</span>
      </div>

      {selectedPlayer && (
        <div className="guess-panel">
          <div className="guess-title">
            标记 {selectedPlayer.seat}号 {selectedPlayer.name} 的身份
            <span className="muted">（只有你自己看得到）</span>
          </div>
          <div className="guess-options">
            {guessOptions(setup).map((g) => (
              <button
                key={g}
                className={`guess-option ${guessTeam(g)}${guesses[selectedPlayer.seat] === g ? ' active' : ''}`}
                onClick={() => {
                  onGuess(selectedPlayer.seat, g);
                  setSelected(null);
                }}
              >
                {guessLabel(g)}
              </button>
            ))}
            <button
              className="guess-option clear"
              onClick={() => {
                onGuess(selectedPlayer.seat, null);
                setSelected(null);
              }}
            >
              清除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
