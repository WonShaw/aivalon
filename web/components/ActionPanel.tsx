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
};

export function ActionPanel({ gameId, token, request, players }: Props) {
  const [speech, setSpeech] = useState('');
  const [team, setTeam] = useState<number[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSpeech('');
    setTeam(request.action === 'final_team' ? (request.team ?? []) : []);
    setTarget(null);
    setError(null);
  }, [request.id]);

  const needsSpeech = ['propose', 'speak', 'evil_discuss', 'assassinate'].includes(request.action);
  const allowsSpeech = needsSpeech || request.action === 'final_team';
  const picksTeam = request.action === 'propose' || request.action === 'final_team';

  const submit = async (extra: Partial<ActionSubmission> = {}) => {
    const submission: ActionSubmission = { action: request.action, ...extra };
    if (allowsSpeech && speech.trim()) submission.speech = speech.trim();
    if (picksTeam) submission.team = team;
    if (request.action === 'assassinate' && target !== null) submission.target = target;
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
    (!needsSpeech || speech.trim().length > 0) &&
    (!picksTeam || team.length === request.teamSize) &&
    (request.action !== 'assassinate' || target !== null);

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
      <div className="action-title">{TITLES[request.action]}</div>

      {picksTeam && (
        <div className="action-row">
          <div className="muted">
            选择 {request.teamSize} 人（已选 {team.length}）
          </div>
          <div className="seat-picks">{players.map((p) => seatButton(p.seat, team.includes(p.seat), () => toggleSeat(p.seat)))}</div>
        </div>
      )}

      {request.action === 'vote' && (
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

      {request.action === 'mission' && (
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

      {request.action === 'assassinate' && (
        <div className="action-row">
          <div className="muted">刺杀目标</div>
          <div className="seat-picks">{(request.targets ?? []).map((s) => seatButton(s, target === s, () => setTarget(s)))}</div>
        </div>
      )}

      {allowsSpeech && (
        <div className="action-row">
          <textarea
            value={speech}
            onChange={(e) => setSpeech(e.target.value)}
            placeholder={needsSpeech ? '输入你的发言…' : '（可选）补充一句说明'}
            rows={3}
            maxLength={800}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) void submit();
            }}
          />
        </div>
      )}

      {request.action !== 'vote' && request.action !== 'mission' && (
        <div className="action-row right">
          <span className="muted hint">⌘/Ctrl + Enter 提交</span>
          <button className="primary" disabled={!canSubmit} onClick={() => submit()}>
            提交
          </button>
        </div>
      )}

      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
