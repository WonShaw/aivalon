import { useState } from 'react';
import type { ActionSubmission, ActionType, HumanRequest, PlayerInfo } from '../../shared/types.ts';
import { api } from '../client.ts';
import { CARD_DAGGER, CARD_GRAIL, VOTE_SHIELD, VOTE_SWORD } from '../sprites.ts';
import { PixelArt } from './PixelAvatar.tsx';

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
  chat: '赛后单独对话',
};

// 圆桌上可以点头像选的人：提名时选队员，刺杀时选目标，赛后单独对话时选对象
export interface SeatPick {
  kind: 'team' | 'target' | 'chat';
  label: string;
  size: number;
  seats: number[]; // 可以选的座位
  selected: number[];
  toggle: (seat: number) => void;
  optional?: boolean; // 可以不选：刺客在刺杀讨论中发言时，选了目标就是直接刺杀
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

  // 提前刺杀只是确认进入刺杀阶段：不发言也不选目标（之后讨论完再选），在圆桌中央确认
  const action = early ? 'assassinate' : request.action;
  const targets = request.targets ?? [];
  // 刺客在刺杀讨论中发言时可以同时选目标直接刺杀，这时发言可以不写
  const direct = action === 'evil_discuss' && targets.length > 0;
  const needsSpeech =
    !early && ['propose', 'speak', 'evil_discuss', 'reflect'].includes(action) && !(direct && target !== null);
  const allowsSpeech = !early && (needsSpeech || direct || action === 'final_team' || action === 'assassinate');
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
    : (action === 'assassinate' && !early) || direct
      ? {
          kind: 'target',
          label: '刺杀目标',
          size: 1,
          seats: targets,
          selected: target === null ? [] : [target],
          toggle: (seat) => setTarget(target === seat ? null : seat),
          optional: direct,
        }
      : null;

  const submit = async (extra: Partial<ActionSubmission> = {}) => {
    const submission: ActionSubmission = { action, ...extra };
    // "跳过"会显式传入空发言，不能被输入框里的内容覆盖
    if (allowsSpeech && extra.speech === undefined && speech.trim()) submission.speech = speech.trim();
    if (picksTeam) submission.team = team;
    if (((action === 'assassinate' && !early) || direct) && target !== null) submission.target = target;
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
      (action !== 'assassinate' || early || target !== null),
    submit,
  };
}

// 圆桌中央：投票、出任务牌，以及刺客的提前刺杀
export function TableActions({ act }: { act: HumanAction | null }) {
  if (!act) return null;
  const { action, busy, submit, request } = act;
  return (
    <div className="table-actions">
      {(action === 'vote' || action === 'mission') && (
        <div className="your-turn-label">{action === 'vote' ? '轮到你投票' : '轮到你出任务牌'}</div>
      )}
      {action === 'vote' && (
        <div className="big-buttons">
          <button className="approve" disabled={busy} onClick={() => submit({ vote: 'approve' })}>
            <PixelArt sprite={VOTE_SWORD} className="pixel-art btn-icon" />
            赞成
          </button>
          <button className="reject" disabled={busy} onClick={() => submit({ vote: 'reject' })}>
            <PixelArt sprite={VOTE_SHIELD} className="pixel-art btn-icon" />
            反对
          </button>
        </div>
      )}
      {action === 'mission' && (
        <div className="big-buttons">
          <button className="approve" disabled={busy} onClick={() => submit({ mission_card: 'success' })}>
            <PixelArt sprite={CARD_GRAIL} className="pixel-art btn-icon" />
            成功
          </button>
          <button
            className="reject"
            disabled={busy || !request.canFail}
            title={request.canFail ? '' : '正义方只能出成功'}
            onClick={() => submit({ mission_card: 'fail' })}
          >
            <PixelArt sprite={CARD_DAGGER} className="pixel-art btn-icon" />
            失败
          </button>
        </div>
      )}
      {(action === 'vote' || action === 'mission' || act.early) && act.error && <div className="error-text">{act.error}</div>}
      {request.canAssassinate && !act.early && (
        <button className="early-assassinate" disabled={busy} onClick={() => act.setEarly(true)}>
          ⚔ 提前刺杀
        </button>
      )}
      {act.early && (
        <div className="early-confirm">
          <div className="early-confirm-title">确认发起提前刺杀？</div>
          <div className="early-confirm-hint">当前的组队和任务作废，邪恶方亮明身份并讨论，最后由你选择刺杀目标。不能反悔。</div>
          <div className="early-confirm-buttons">
            <button className="early-assassinate" disabled={busy} onClick={() => submit()}>
              ⚔ 确认刺杀
            </button>
            <button className="early-cancel" disabled={busy} onClick={() => act.setEarly(false)}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 赛后单独对话：在圆桌上点一名 AI，对他说一段话，他会公开回复。发送后对象不变，可以接着聊
export interface PostgameChat {
  target: number | null;
  pick: SeatPick;
  text: string;
  setText: (s: string) => void;
  busy: boolean;
  waiting: boolean; // 赛后交流正在进行（AI 在回复，或者一轮发言还没结束），暂时不能发
  error: string | null;
  canSend: boolean;
  send: () => Promise<void>;
}

export function usePostgameChat(gameId: string, token: string | null, aiSeats: number[], waiting: boolean): PostgameChat {
  const [target, setTarget] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!token || target === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.chat(gameId, token, target, text.trim());
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return {
    target,
    pick: {
      kind: 'chat',
      label: '对话对象',
      size: 1,
      seats: aiSeats,
      selected: target === null ? [] : [target],
      toggle: (seat) => setTarget(target === seat ? null : seat),
    },
    text,
    setText,
    busy,
    waiting,
    error,
    canSend: !busy && !waiting && !!token && target !== null && text.trim().length > 0,
    send,
  };
}

export function ChatComposer({ chat, players, onClose }: { chat: PostgameChat; players: PlayerInfo[]; onClose: () => void }) {
  const name = chat.target === null ? '' : (players.find((p) => p.seat === chat.target)?.name ?? '');
  return (
    <div className="composer">
      <div className="composer-head">
        <span className="composer-title">赛后单独对话</span>
        <span className={`composer-hint${chat.target === null ? ' todo' : ''}`}>
          {chat.target === null ? '在圆桌上点一名 AI 选择对话对象' : `对 ${chat.target}号 ${name} 说`}
        </span>
        <div className="spacer" />
        <button className="link" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="muted small-text">对话是公开的：所有人都能看到，之后其他 AI 发言时也会看到。</div>
      <textarea
        autoFocus
        value={chat.text}
        onChange={(e) => chat.setText(e.target.value)}
        placeholder={chat.target === null ? '先选一名 AI…' : `想对 ${name} 说什么…`}
        rows={3}
        maxLength={800}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && chat.canSend) void chat.send();
        }}
      />
      <div className="composer-foot">
        {chat.error && <span className="error-text">{chat.error}</span>}
        {chat.waiting && <span className="muted hint">等当前的发言结束后再发送</span>}
        <div className="spacer" />
        <span className="muted hint">⌘/Ctrl + Enter 发送</span>
        <button className="primary" disabled={!chat.canSend} onClick={() => chat.send()}>
          发送
        </button>
      </div>
    </div>
  );
}

// 发言框：放在右侧时间线下方，像会议里的发言输入框，不挡圆桌；提交后随请求一起消失
export function Composer({ act }: { act: HumanAction }) {
  const { action, request, busy, speech } = act;
  if (!act.allowsSpeech) return null;

  const title = TITLES[request.action];
  const direct = !!act.pick?.optional;
  const pickHint = act.picksTeam
    ? `在圆桌上点头像选 ${request.teamSize} 人（已选 ${act.team.length}）`
    : direct
      ? act.target === null
        ? '可以同时在圆桌上点头像，直接刺杀'
        : `刺杀目标：${act.target}号（提交后直接结算，跳过其他人的讨论）`
      : action === 'assassinate'
        ? act.target === null
          ? '在圆桌上点头像选择刺杀目标'
          : `刺杀目标：${act.target}号`
        : null;
  const killing = action === 'assassinate' || (direct && act.target !== null);

  return (
    <div className={`composer${killing ? ' danger' : ''}`}>
      <div className="composer-head">
        <span className="composer-title">{title}</span>
        {pickHint && (
          <span className={`composer-hint${act.pick && !act.pick.optional && act.pick.selected.length < act.pick.size ? ' todo' : ''}`}>
            {pickHint}
          </span>
        )}
      </div>
      <textarea
        autoFocus
        value={speech}
        onChange={(e) => act.setSpeech(e.target.value)}
        placeholder={
          act.needsSpeech ? '输入你的发言…' : killing ? '（可选）说一句刺杀宣言' : '（可选）补充一句说明'
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
        <button className={killing ? 'assassinate' : 'primary'} disabled={!act.canSubmit} onClick={() => act.submit()}>
          {killing ? '确认刺杀' : '提交'}
        </button>
      </div>
    </div>
  );
}
