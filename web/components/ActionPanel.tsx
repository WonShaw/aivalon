import { useState } from 'react';
import type { ActionSubmission, ActionType, HumanRequest, PlayerInfo } from '../../shared/types.ts';
import { api } from '../client.ts';

// 人类玩家的操作分在两处：选人和投票、出任务牌在圆桌上，打字在圆桌下方弹出的发言框里。
// 两处共用 useHumanAction 里的状态

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

// 圆桌上可以点头像选的人：提名时选队员，刺杀时选目标
export interface SeatPick {
  kind: 'team' | 'target';
  label: string;
  size: number;
  seats: number[]; // 可以选的座位
  selected: number[];
  toggle: (seat: number) => void;
}

export interface HumanAction {
  request: HumanRequest;
  action: ActionType; // 实际要提交的动作：提前刺杀时是 assassinate
  early: boolean; // 刺客不做这个动作，改为提前刺杀
  setEarly: (on: boolean) => void;
  speech: string;
  setSpeech: (s: string) => void;
  team: number[];
  target: number | null;
  pick: SeatPick | null;
  picksTeam: boolean;
  needsSpeech: boolean; // 必须发言
  allowsSpeech: boolean; // 可以发言（需要弹出发言框）
  busy: boolean;
  error: string | null;
  canSubmit: boolean;
  submit: (extra?: Partial<ActionSubmission>) => Promise<void>;
}

export function useHumanAction(
  gameId: string,
  token: string | null,
  request: HumanRequest | null,
  players: PlayerInfo[],
): HumanAction | null {
  const [forId, setForId] = useState<string | null>(null);
  const [speech, setSpeech] = useState('');
  const [team, setTeam] = useState<number[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const [early, setEarlyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 换了新的请求就重置（在渲染时重置，免得第一帧用上一个请求的状态）
  const id = request?.id ?? null;
  if (id !== forId) {
    setForId(id);
    setSpeech('');
    setTeam(request?.action === 'final_team' ? (request.team ?? []) : []);
    setTarget(null);
    setEarlyState(false);
    setError(null);
  }

  if (!request || !token || id !== forId) return null;

  // 提前刺杀按刺杀动作处理，目标是除自己以外的所有人
  const action = early ? 'assassinate' : request.action;
  const targets = early ? players.filter((p) => p.seat !== request.seat).map((p) => p.seat) : (request.targets ?? []);
  const needsSpeech = ['propose', 'speak', 'evil_discuss', 'reflect'].includes(action);
  const allowsSpeech = needsSpeech || action === 'final_team' || action === 'assassinate';
  const picksTeam = action === 'propose' || action === 'final_team';
  const pick: SeatPick | null = picksTeam
    ? {
        kind: 'team',
        label: action === 'final_team' ? '最终提名' : '你的提名',
        size: request.teamSize ?? 0,
        seats: players.map((p) => p.seat),
        selected: team,
        toggle: (seat) => setTeam(team.includes(seat) ? team.filter((s) => s !== seat) : [...team, seat].sort((a, b) => a - b)),
      }
    : action === 'assassinate'
      ? {
          kind: 'target',
          label: '刺杀目标',
          size: 1,
          seats: targets,
          selected: target === null ? [] : [target],
          toggle: (seat) => setTarget(target === seat ? null : seat),
        }
      : null;

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

  return {
    request,
    action,
    early,
    setEarly: (on) => {
      setEarlyState(on);
      setTarget(null);
      setError(null);
    },
    speech,
    setSpeech,
    team,
    target,
    pick,
    picksTeam,
    needsSpeech,
    allowsSpeech,
    busy,
    error,
    canSubmit:
      !busy &&
      (!needsSpeech || speech.trim().length > 0) &&
      (!picksTeam || team.length === request.teamSize) &&
      (action !== 'assassinate' || target !== null),
    submit,
  };
}

// 圆桌中央：投票、出任务牌，以及刺客的提前刺杀
export function TableActions({ act }: { act: HumanAction | null }) {
  if (!act) return null;
  const { action, busy, submit, request } = act;
  return (
    <div className="table-actions">
      {action === 'vote' && (
        <div className="big-buttons">
          <button className="approve" disabled={busy} onClick={() => submit({ vote: 'approve' })}>
            ✓ 赞成
          </button>
          <button className="reject" disabled={busy} onClick={() => submit({ vote: 'reject' })}>
            ✗ 反对
          </button>
        </div>
      )}
      {action === 'mission' && (
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
      )}
      {(action === 'vote' || action === 'mission') && act.error && <div className="error-text">{act.error}</div>}
      {request.canAssassinate && !act.early && (
        <button className="early-assassinate" disabled={busy} onClick={() => act.setEarly(true)}>
          ⚔ 提前刺杀
        </button>
      )}
    </div>
  );
}

// 圆桌下方弹出的发言框，提交后随请求一起消失；可以先收起来看看局面
export function Composer({ act }: { act: HumanAction }) {
  const [collapsed, setCollapsed] = useState(false);
  const { action, request, early, busy, speech } = act;
  if (!act.allowsSpeech) return null;

  const title = early ? '提前刺杀：选择刺杀目标' : TITLES[request.action];
  if (collapsed) {
    return (
      <button className="composer-pill" onClick={() => setCollapsed(false)}>
        ✎ {title} · 展开
      </button>
    );
  }

  const pickHint = act.picksTeam
    ? `在圆桌上点头像选 ${request.teamSize} 人（已选 ${act.team.length}）`
    : action === 'assassinate'
      ? act.target === null
        ? '在圆桌上点头像选择刺杀目标'
        : `刺杀目标：${act.target}号`
      : null;

  return (
    <div className={`composer${early || action === 'assassinate' ? ' danger' : ''}`}>
      <div className="composer-head">
        <span className="composer-title">{title}</span>
        {pickHint && <span className={`composer-hint${act.pick && act.pick.selected.length < act.pick.size ? ' todo' : ''}`}>{pickHint}</span>}
        <div className="spacer" />
        <button className="link" onClick={() => setCollapsed(true)} title="先收起来，看看局面">
          收起
        </button>
      </div>
      {early && (
        <div className="muted small-text">
          当前的组队和任务作废，不进行讨论，直接按你选的目标结算：刺中梅林邪恶方获胜，刺错正义方获胜。
        </div>
      )}
      <textarea
        autoFocus
        value={speech}
        onChange={(e) => act.setSpeech(e.target.value)}
        placeholder={
          act.needsSpeech ? '输入你的发言…' : action === 'assassinate' ? '（可选）说一句刺杀宣言' : '（可选）补充一句说明'
        }
        rows={3}
        maxLength={800}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && act.canSubmit) void act.submit();
        }}
      />
      <div className="composer-foot">
        {act.error && <span className="error-text">{act.error}</span>}
        <div className="spacer" />
        <span className="muted hint">⌘/Ctrl + Enter 提交</span>
        {action === 'reflect' && (
          <button disabled={busy} onClick={() => act.submit({ speech: '' })}>
            跳过
          </button>
        )}
        {early && (
          <button disabled={busy} onClick={() => act.setEarly(false)}>
            返回
          </button>
        )}
        <button className={action === 'assassinate' ? 'assassinate' : 'primary'} disabled={!act.canSubmit} onClick={() => act.submit()}>
          {action === 'assassinate' ? '确认刺杀' : '提交'}
        </button>
      </div>
    </div>
  );
}
