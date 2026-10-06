import { useEffect, useState } from 'react';
import type { ActionSubmission, HumanRequest, PlayerInfo } from '../../shared/types.ts';
import { api } from '../client.ts';
import { seatHue } from '../format.ts';

interface Props {
  gameId: string;
  token: string;
  request: HumanRequest;
  players: PlayerInfo[];
}

const TITLES: Record<HumanRequest['action'], string> = {
  propose: '你是队长：发言并提名队伍',
  speak: '轮到你发言',
  final_team: '大家都说完了：确认或修改你的提名',
  vote: '投票：是否同意这支队伍出发？',
  mission: '你在任务队伍中：请出任务牌',
  evil_discuss: '刺杀阶段：和同伴讨论谁是梅林',
  assassinate: '你是刺客：选择刺杀目标',
  reflect: '赛后交流：聊聊你对这局的感想',
};

export function ActionPanel({ gameId, token, request, players }: Props) {
  const [speech, setSpeech] = useState('');
  const [team, setTeam] = useState<number[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const [early, setEarly] = useState(false); // 刺客不做这个动作，改为提前刺杀
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSpeech('');
    setTeam(request.action === 'final_team' ? (request.team ?? []) : []);
    setTarget(null);
    setEarly(false);
    setError(null);
  }, [request.id]);

  // 提前刺杀按刺杀动作处理，目标是除自己以外的所有人
  const action = early ? 'assassinate' : request.action;
  const targets = early ? players.filter((p) => p.seat !== request.seat).map((p) => p.seat) : (request.targets ?? []);

  const needsSpeech = ['propose', 'speak', 'evil_discuss'].includes(action);
  const isReflect = action === 'reflect';
  const allowsSpeech = needsSpeech || action === 'final_team' || action === 'assassinate' || isReflect;
  const picksTeam = action === 'propose' || action === 'final_team';

  const submit = async (extra: Partial<ActionSubmission> = {}) => {
    const submission: ActionSubmission = { action, ...extra };
    // "跳过"会显式传入空发言，不能被输入框里的内容覆盖
    if (allowsSpeech && extra.speech === undefined && speech.trim()) submission.speech = speech.trim();
    if (picksTeam) submission.team = team;
    if (action === 'assassinate' && target !== null) submission.target = target;
    setBusy(true);
    setError(null);
    try {
      await api.act(gameId, token, submission);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleSeat = (seat: number) =>
    setTeam((t) => (t.includes(seat) ? t.filter((s) => s !== seat) : [...t, seat].sort((a, b) => a - b)));

  const canSubmit =
    !busy &&
    (!(needsSpeech || isReflect) || speech.trim().length > 0) &&
    (!picksTeam || team.length === request.teamSize) &&
    (action !== 'assassinate' || target !== null);

  const seatButton = (seat: number, selected: boolean, onClick: () => void) => {
    const p = players.find((x) => x.seat === seat)!;
    return (
      <button
        key={seat}
        type="button"
        className={`seat-pick${selected ? ' selected' : ''}`}
        style={{ '--hue': seatHue(seat) } as React.CSSProperties}
        onClick={onClick}
      >
        {seat} {p.name}
      </button>
    );
  };

  return (
    <div className="action-panel">
      <div className="action-title">{early ? '提前刺杀：选择刺杀目标' : TITLES[request.action]}</div>
      {early && (
        <div className="muted small-text">
          当前的组队和任务作废，不进行讨论，直接按你选的目标结算：刺中梅林邪恶方获胜，刺错正义方获胜。
        </div>
      )}

      {picksTeam && (
        <div className="action-row">
          <div className="muted">
            选择 {request.teamSize} 人（已选 {team.length}）
          </div>
          <div className="seat-picks">{players.map((p) => seatButton(p.seat, team.includes(p.seat), () => toggleSeat(p.seat)))}</div>
        </div>
      )}

      {action === 'vote' && (
        <div className="action-row">
          <div className="muted">队伍：{request.team?.map((s) => `${s}号`).join('、')}</div>
          <div className="big-buttons">
            <button className="approve" disabled={busy} onClick={() => submit({ vote: 'approve' })}>
              ✓ 赞成
            </button>
            <button className="reject" disabled={busy} onClick={() => submit({ vote: 'reject' })}>
              ✗ 反对
            </button>
          </div>
        </div>
      )}

      {action === 'mission' && (
        <div className="action-row">
          <div className="big-buttons">
            <button className="approve" disabled={busy} onClick={() => submit({ mission_card: 'success' })}>
              成功
            </button>
            <button
              className="reject"
              disabled={busy || !request.canFail}
              title={request.canFail ? '' : '正义方只能出成功'}
              onClick={() => submit({ mission_card: 'fail' })}
            >
              失败
            </button>
          </div>
        </div>
      )}

      {action === 'assassinate' && (
        <div className="action-row">
          <div className="muted">刺杀目标</div>
          <div className="seat-picks">{targets.map((s) => seatButton(s, target === s, () => setTarget(s)))}</div>
        </div>
      )}

      {allowsSpeech && (
        <div className="action-row">
          <textarea
            value={speech}
            onChange={(e) => setSpeech(e.target.value)}
            placeholder={needsSpeech ? '输入你的发言…' : action === 'assassinate' ? '（可选）说一句刺杀宣言' : '（可选）补充一句说明'}
            rows={3}
            maxLength={800}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) void submit();
            }}
          />
        </div>
      )}

      {action !== 'vote' && action !== 'mission' && (
        <div className="action-row right">
          <span className="muted hint">⌘/Ctrl + Enter 提交</span>
          {isReflect && (
            <button disabled={busy} onClick={() => submit({ speech: '' })}>
              跳过
            </button>
          )}
          {early && (
            <button disabled={busy} onClick={() => setEarly(false)}>
              返回
            </button>
          )}
          <button className={early ? 'assassinate' : 'primary'} disabled={!canSubmit} onClick={() => submit()}>
            {early ? '确认刺杀' : '提交'}
          </button>
        </div>
      )}

      {request.canAssassinate && !early && (
        <div className="action-row right early">
          <span className="muted hint">你是刺客，也可以不做上面的动作，直接提前刺杀</span>
          <button
            className="assassinate"
            disabled={busy}
            onClick={() => {
              setEarly(true);
              setTarget(null);
              setError(null);
            }}
          >
            ⚔ 提前刺杀
          </button>
        </div>
      )}

      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
