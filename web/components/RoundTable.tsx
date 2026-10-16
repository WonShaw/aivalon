import { useState, type ReactNode } from 'react';
import type { ActionType, PlayerInfo, Role, SeatMark, Viewer } from '../../shared/types.ts';
import { teamSizes } from '../../shared/setup.ts';
import type { BoardState } from '../derive.ts';
import { ACTION_LABEL, roleLabel, roleTone, seatHue } from '../format.ts';
import { guessLabel, guessOptions, guessTeam, type Guess } from '../guesses.ts';
import type { SeatPick } from './ActionPanel.tsx';
import { PixelArt, PixelAvatar, PixelFrames } from './PixelAvatar.tsx';
import { BANNER, FLAG_EVIL, FLAG_GOOD, TOWER, VOTE_SHIELD, VOTE_SWORD, WAGON } from '../sprites.ts';
import { avatarOf } from '../../shared/avatars.ts';

interface Props {
  setup: Role[];
  players: PlayerInfo[];
  board: BoardState;
  acting: Record<number, ActionType>;
  speaking?: number | null; // 正在朗读谁的发言
  viewer: Viewer | null;
  roles: Record<number, Role>; // 当前观看者能看到的身份
  guesses: Record<number, Guess>;
  onGuess: (seat: number, guess: Guess | null) => void;
  pick?: SeatPick | null; // 轮到你选人时：点头像选人，不再用来标记猜测
  actions?: ReactNode; // 放在桌子中央提名列表下面，例如投票按钮
}

export function RoundTable({ setup, players, board, acting, speaking, viewer, roles, guesses, onGuess, pick, actions }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const mySeat = viewer?.kind === 'player' ? viewer.seat : null;
  const marks: Record<number, SeatMark> = {};
  for (const m of board.myRole?.marks ?? []) marks[m.seat] = m;

  // 自己和已经能看到身份的座位不需要标记
  const canGuess = (seat: number) => !pick && seat !== mySeat && !roles[seat];
  const selectedPlayer = selected !== null && canGuess(selected) ? players.find((p) => p.seat === selected) : undefined;

  // 桌子中央的提名列表：轮到你选人时是你的选择，否则是本轮当前的提名
  const result = board.missionResults[board.mission - 1];
  const slots: { label: string; size: number; seats: number[]; tone?: string } | null = pick
    ? { label: `${pick.label} ${pick.selected.length}/${pick.size}`, size: pick.size, seats: pick.selected, tone: pick.kind === 'target' ? 'evil' : 'pick' }
    : board.gameOver || board.assassination || !board.teamSize
      ? null
      : {
          label: result
            ? `任务${result.success ? '成功' : '失败'}`
            : board.lastVote
              ? board.lastVote.approved
                ? '组队成功 · 队伍出征中'
                : '组队被否决'
              : board.proposedTeam.length
                ? board.proposalFinal
                  ? '最终提名'
                  : '初步提名'
                : '等待队长提名',
          size: board.teamSize,
          seats: board.proposedTeam,
          tone: result
            ? result.success
              ? 'good'
              : 'evil'
            : board.lastVote && !board.lastVote.approved
              ? 'evil'
              : board.proposalFinal
                ? 'final'
                : undefined,
        };
  // 选刺杀目标时不再显示提名的队伍（提前刺杀时当前的组队作废），只突出目标
  const team = pick ? (pick.kind === 'team' ? pick.selected : []) : board.proposedTeam;

  // 出征的马车：停在最后一个已完成的据点下面（还没完成过就在路的起点）；队伍出征时从那里驶向当前任务的据点，
  // 到了就原地等结果。不按固定时长"到站"，免得从快慢看出什么
  const sizes = teamSizes(players.length);
  const lastDone = board.missionResults.reduce((last, r, i) => (r ? i : last), -1);
  const parked = lastDone >= 0 ? lastDone : -0.6;
  const wagonTo = board.onMission ? board.mission - 1 : parked;

  return (
    <div className={`table-wrap seats-${players.length}`}>
      <div className="table">
        <div className="table-center">
          <div className="table-title">
            {board.gameOver ? '游戏结束' : board.assassination ? '刺杀阶段' : `第 ${board.mission} 个任务`}
          </div>
          <div className="mission-map">
            <div className="missions">
              {sizes.map((size, i) => {
                const r = board.missionResults[i];
                const cls = r
                  ? r.success
                    ? 'mission ok'
                    : 'mission bad'
                  : i + 1 === board.mission && !board.gameOver
                    ? 'mission current'
                    : 'mission';
                return (
                  <div key={i} className={cls} title={r ? `第 ${i + 1} 个任务：失败票 ${r.fails} 张` : `第 ${i + 1} 个任务：需要 ${size} 人`}>
                    <PixelArt sprite={TOWER} />
                    {r && (
                      <span className="mission-flag">
                        <PixelArt sprite={r.success ? FLAG_GOOD : FLAG_EVIL} />
                      </span>
                    )}
                    <span className="mission-size">{size}</span>
                    {i === 3 && !r && <span className="mission-note">2败</span>}
                  </div>
                );
              })}
            </div>
            <div className="road">
              <span
                key={board.onMission ? `go-${board.mission}` : `park-${parked}`}
                className={`wagon${board.onMission ? ' moving' : ''}`}
                style={{ '--from': parked, '--to': wagonTo } as React.CSSProperties}
                title={board.onMission ? '队伍正在出征' : undefined}
              >
                <PixelFrames frames={WAGON} className={board.onMission ? 'animate' : undefined} />
              </span>
            </div>
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
          {board.gameOver && (
            <div className={`table-winner ${board.gameOver.winner}`}>
              {board.gameOver.winner === 'good' ? '正义方获胜' : '邪恶方获胜'}
            </div>
          )}
          {slots && (
            <div className={`slots${slots.tone ? ` ${slots.tone}` : ''}`}>
              <div className="slots-label">{slots.label}</div>
              <div className="slots-row">
                {Array.from({ length: slots.size }, (_, i) => {
                  const seat = slots.seats[i];
                  const player = seat === undefined ? undefined : players.find((p) => p.seat === seat);
                  return seat === undefined ? (
                    <span key={i} className="slot">
                      <span className="shield empty">
                        <span className="shield-inner" />
                      </span>
                    </span>
                  ) : (
                    <button
                      key={i}
                      type="button"
                      className="slot"
                      style={{ '--hue': seatHue(seat) } as React.CSSProperties}
                      disabled={!pick}
                      title={pick ? '点击移出' : `${seat}号 ${player?.name ?? ''}`}
                      onClick={pick ? () => pick.toggle(seat) : undefined}
                    >
                      <span className="shield">
                        <span className="shield-inner">{player && <PixelAvatar id={avatarOf(player)} />}</span>
                      </span>
                      <span className="slot-no">{seat}</span>
                    </button>
                  );
                })}
              </div>
              {pick && pick.selected.length < pick.size && <div className="slots-hint">点击头像{{ team: '选人', target: '选择目标', chat: '选择对话对象' }[pick.kind]}</div>}
            </div>
          )}
          {actions}
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
              <button className="guess-option clear" onClick={() => setSelected(null)}>
                取消
              </button>
            </div>
          </div>
        )}

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
          const speakingNow = p.seat === speaking;
          const mark = marks[p.seat];
          const guess = guesses[p.seat];
          const guessable = canGuess(p.seat);
          const pickable = !!pick?.seats.includes(p.seat);
          const classes = ['seat'];
          if (act || speakingNow) classes.push('acting');
          if (team.includes(p.seat)) classes.push('in-team');
          if (pick?.kind === 'target' && pick.selected.includes(p.seat)) classes.push('targeted');
          if (pick?.kind === 'chat' && pick.selected.includes(p.seat)) classes.push('chat-target');
          if (pickable) classes.push('pickable');
          if (p.seat === mySeat) classes.push('me');
          if (guessable) classes.push('guessable');
          if (selected === p.seat) classes.push('selected');

          return (
            <div
              key={p.seat}
              className={classes.join(' ')}
              style={style}
              onClick={
                pickable ? () => pick!.toggle(p.seat) : guessable ? () => setSelected(selected === p.seat ? null : p.seat) : undefined
              }
              title={
                pickable
                  ? { team: '点击选入或移出队伍', target: '点击选为刺杀目标', chat: '点击选为对话对象' }[pick!.kind]
                  : guessable
                    ? '点击标记你对他身份的猜测'
                    : undefined
              }
            >
              <div className="avatar-wrap">
                <div className="avatar pixel">
                  <PixelAvatar id={avatarOf(p)} />
                </div>
                <span className="seat-no">{p.seat}</span>
                {board.leader === p.seat && !board.gameOver && (
                  <span className="leader-banner" title="队长">
                    <PixelFrames frames={BANNER} className="animate" />
                  </span>
                )}
                {team.includes(p.seat) && (
                  <span className="team-mark" title="在本轮提名的队伍里">
                    ⚔
                  </span>
                )}
                {vote && (
                  <span key={board.lastVote!.seq} className={`vote-token ${vote}`} title={vote === 'approve' ? '赞成' : '反对'}>
                    <span className="vote-back" />
                    <span className="vote-face">
                      <PixelArt sprite={vote === 'approve' ? VOTE_SWORD : VOTE_SHIELD} />
                    </span>
                  </span>
                )}
              </div>
              <div className="seat-name">{p.name}</div>
              <div className={`seat-sub${act || speakingNow ? ' acting-text' : ''}`}>
                {speakingNow
                  ? '发言中'
                  : act
                    ? `${p.kind === 'human' ? '等待' : '思考'}·${ACTION_LABEL[act]}`
                    : p.seat === mySeat
                      ? '你'
                      : p.kind === 'human'
                        ? '人类'
                        : 'AI'}
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
    </div>
  );
}

export function TableLegend() {
  return (
    <div className="table-legend">
      <span>
        <span className="legend-icon">
          <PixelArt sprite={BANNER[0]} />
        </span>
        队长
      </span>
      <span>
        <span className="legend-ring" />⚔ 提名的队伍
      </span>
      <span>
        <span className="legend-acting" />正在行动
      </span>
      <span>
        <span className="legend-icon">
          <PixelArt sprite={VOTE_SWORD} />
        </span>
        <span className="legend-icon">
          <PixelArt sprite={VOTE_SHIELD} />
        </span>
        上一次投票
      </span>
    </div>
  );
}
