import { useEffect, useRef, type ReactNode } from 'react';
import type { ActionType, GameEvent, PlayerInfo, Role, SpeechKind, Viewer } from '../../shared/types.ts';
import { describeSetup } from '../../shared/setup.ts';
import { ACTION_LABEL, playerName, roleLabel, roleTone, seatHue } from '../format.ts';

interface Props {
  events: GameEvent[];
  players: PlayerInfo[];
  viewer: Viewer | null;
  fullView: boolean; // 能看到全部信息：观众，或对局正常结束后的玩家
  godView: boolean; // 上帝视角：其他人的身份、任务牌和思考摘要
  roles: Record<number, Role>; // 当前观看者能看到的身份
  acting: Record<number, ActionType>;
  live: Record<number, { action: ActionType; speech: string }>;
  children?: ReactNode; // 放在时间线最后，例如"再来一局"
}

const SPEECH_KIND: Record<SpeechKind, string> = {
  propose: '提名发言',
  discuss: '',
  final: '最终提名',
  assassin_discuss: '刺杀讨论',
  assassinate: '刺杀宣言',
  reflect: '赛后感想',
};

const SPEAKING_ACTIONS: ActionType[] = ['propose', 'speak', 'final_team', 'evil_discuss', 'assassinate', 'reflect'];

export function Timeline(props: Props) {
  const { events, players, viewer, fullView, godView, acting, live } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const mySeat = viewer?.kind === 'player' ? viewer.seat : null;

  const roleOf = (seat: number): Role | undefined => props.roles[seat];
  const name = (seat: number) => playerName(players, seat);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  });

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const speaker = (seat: number) => {
    const role = roleOf(seat);
    return (
      <>
        <b>{name(seat)}</b>
        <span className="muted">{seat}号{seat === mySeat ? '（你）' : ''}</span>
        {role && <span className={`badge small ${roleTone(role)}`}>{roleLabel(role)}</span>}
      </>
    );
  };

  const seatChips = (seats: number[]) => (
    <span className="chips">
      {seats.map((s) => (
        <span key={s} className="chip" style={{ '--hue': seatHue(s) } as React.CSSProperties}>
          {s} {name(s)}
        </span>
      ))}
    </span>
  );

  const render = (e: GameEvent) => {
    switch (e.type) {
      case 'game_start':
        return (
          <div className="divider">
            游戏开始 · 首位队长 {e.firstLeader}号 {name(e.firstLeader)}
            {e.setup && <div className="muted small-text">{describeSetup(e.setup)}</div>}
          </div>
        );
      case 'role_assigned':
        if (e.seat === mySeat) {
          return (
            <div className={`role-card ${roleTone(e.role)}`}>
              <div className="role-card-title">你的身份：{roleLabel(e.role)}</div>
              <div>{e.knowledge}</div>
            </div>
          );
        }
        if (!fullView || !godView) return null;
        return (
          <div className="sys small">
            {e.seat}号 {name(e.seat)} 的身份：
            <span className={`badge small ${roleTone(e.role)}`}>{roleLabel(e.role)}</span>
            <span className="muted">{e.knowledge}</span>
          </div>
        );
      case 'round_start':
        return (
          <div className="round-head">
            <div>
              第 {e.mission} 个任务 · 第 {e.attempt} 次组队
              {e.attempt === 5 && <span className="warn"> · 最后一次机会</span>}
            </div>
            <div className="muted">
              队长 {e.leader}号 {name(e.leader)} · 需要 {e.teamSize} 人
              {e.failsRequired > 1 && ` · 需 ${e.failsRequired} 张失败票才失败`}
            </div>
          </div>
        );
      case 'speech': {
        const label = SPEECH_KIND[e.kind];
        return (
          <div className={`msg${e.seat === mySeat ? ' mine' : ''}`}>
            <div className="avatar" style={{ '--hue': seatHue(e.seat) } as React.CSSProperties}>
              {e.seat}
            </div>
            <div className="msg-body">
              <div className="msg-head">
                {speaker(e.seat)}
                {label && <span className="kind">{label}</span>}
              </div>
              <div className="msg-text">{e.text}</div>
            </div>
          </div>
        );
      }
      case 'thought':
        // 服务端只在允许时推送思考摘要：全 AI 对局的观众，或对局结束后的玩家
        if (!fullView || !godView) return null;
        return (
          <div className="thought">
            <div className="thought-head">
              思考摘要 · {e.seat}号 {name(e.seat)} · {ACTION_LABEL[e.action]}
            </div>
            <div className="thought-text">{e.summary}</div>
          </div>
        );
      case 'team_proposed':
        return (
          <div className={`sys${e.final ? ' strong' : ''}`}>
            {e.leader}号 {name(e.leader)} {e.final ? '最终提名' : '初步提名'}：{seatChips(e.team)}
          </div>
        );
      case 'team_vote': {
        const seats = Object.keys(e.votes).map(Number).sort((a, b) => a - b);
        const approvals = seats.filter((s) => e.votes[s] === 'approve').length;
        return (
          <div className={`vote-card ${e.approved ? 'ok' : 'bad'}`}>
            <div className="vote-title">
              投票结果：{approvals} 赞成 / {seats.length - approvals} 反对 → {e.approved ? '组队成功' : '组队失败'}
            </div>
            <div className="vote-grid">
              {seats.map((s) => (
                <div key={s} className={`vote-cell ${e.votes[s]}`}>
                  <span>
                    {s} {name(s)}
                  </span>
                  <b>{e.votes[s] === 'approve' ? '✓' : '✗'}</b>
                </div>
              ))}
            </div>
          </div>
        );
      }
      case 'mission_cards':
        if (!fullView || !godView) return null;
        return (
          <div className="sys small">
            任务牌（对局中仅观众可见）：
            {Object.entries(e.cards).map(([s, c]) => (
              <span key={s} className={`badge small ${c === 'success' ? 'good' : 'evil'}`}>
                {s}号 {c === 'success' ? '成功' : '失败'}
              </span>
            ))}
          </div>
        );
      case 'mission_result':
        return (
          <div className={`banner ${e.success ? 'good' : 'evil'}`}>
            第 {e.mission} 个任务{e.success ? '成功' : '失败'} · 失败票 {e.fails} 张
            <div className="banner-sub">队伍：{seatChips(e.team)}</div>
          </div>
        );
      case 'assassination_start':
        return (
          <div className="banner evil">
            {e.declaredBy
              ? `${e.declaredBy}号 ${name(e.declaredBy)} 亮明刺客身份，发起提前刺杀！`
              : '正义方完成 3 个任务，进入刺杀阶段'}
            <div className="banner-sub">
              {e.declaredBy ? (
                '当前的组队和任务作废，由刺客直接选择刺杀目标'
              ) : (
                <>
                  邪恶方亮明身份：
                  {e.evil.map((x) => (
                    <span key={x.seat} className="badge small evil">
                      {x.seat}号 {name(x.seat)} · {roleLabel(x.role)}
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>
        );
      case 'assassination':
        return (
          <div className={`banner ${e.hit ? 'evil' : 'good'}`}>
            刺客 {e.assassin}号 刺杀了 {e.target}号 {name(e.target)}（{roleLabel(e.targetRole)}）→ {e.hit ? '刺中梅林！' : '没有刺中梅林'}
          </div>
        );
      case 'game_over':
        return (
          <div className={`banner big ${e.winner}`}>
            {e.winner === 'good' ? '正义方获胜' : '邪恶方获胜'}
            <div className="banner-sub">{e.reason}</div>
            <div className="banner-sub">
              {Object.entries(e.roles).map(([s, r]) => (
                <span key={s} className={`badge small ${roleTone(r)}`}>
                  {s}号 {name(Number(s))} · {roleLabel(r)}
                </span>
              ))}
            </div>
          </div>
        );
      case 'postgame_start':
        return (
          <div className="round-head">
            赛后交流{(e.round ?? 1) > 1 && ` · 第 ${e.round} 轮`} · 每人发言一次
          </div>
        );
      case 'postgame_end':
        return <div className="divider">赛后交流结束</div>;
      case 'ai_error':
        if (!fullView) return null;
        return (
          <div className="sys small error">
            {e.seat}号 {name(e.seat)}（{ACTION_LABEL[e.action]}）：{e.message}
          </div>
        );
      case 'ai_usage':
        return null;
    }
  };

  // 底部：正在进行中的动作
  const actingSeats = Object.entries(acting).map(([s, a]) => [Number(s), a] as const);
  const voting = actingSeats.filter(([, a]) => a === 'vote');
  // 组队成功后、任务结果公布前，都显示"正在执行任务"（不暴露具体谁还没出牌）
  const lastVote = events.findLast((e) => e.type === 'team_vote');
  const missionActing =
    lastVote?.type === 'team_vote' &&
    lastVote.approved &&
    !events.some((e) => e.type === 'mission_result' && e.seq > lastVote.seq);
  const speakingSeats = actingSeats.filter(([, a]) => SPEAKING_ACTIONS.includes(a)).map(([s]) => s);

  return (
    <div className="timeline" ref={scrollRef} onScroll={onScroll}>
      {events.map((e) => {
        const node = render(e);
        return node ? <div key={e.seq}>{node}</div> : null;
      })}

      {speakingSeats.map((seat) => {
        const text = live[seat]?.speech;
        const isHuman = players.find((p) => p.seat === seat)?.kind === 'human';
        return (
          <div key={`live-${seat}`} className="msg pending">
            <div className="avatar" style={{ '--hue': seatHue(seat) } as React.CSSProperties}>
              {seat}
            </div>
            <div className="msg-body">
              <div className="msg-head">
                {speaker(seat)}
                <span className="kind">{ACTION_LABEL[acting[seat]]}</span>
              </div>
              <div className="msg-text">
                {text ? (
                  <>
                    {text}
                    <span className="caret" />
                  </>
                ) : (
                  <span className="muted dots">{isHuman ? (seat === mySeat ? '轮到你了' : '正在输入') : '正在思考'}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {voting.length > 0 && <div className="sys muted dots">投票进行中，还有 {voting.length} 人未投</div>}
      {missionActing && <div className="sys muted dots">队伍正在执行任务</div>}
      {props.children}
    </div>
  );
}
