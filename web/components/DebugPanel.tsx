import { useState } from 'react';
import type { PlayerInfo } from '../../shared/types.ts';
import { api } from '../client.ts';

// 调试模式：以裁判身份向某个 AI 提问。AI 在从自己游戏会话 fork 出来的会话里回答，不会进入游戏，
// 问答显示在时间线上（只有调试模式下看得到）
export function DebugAsk({
  gameId,
  token,
  players,
  pendingSeats,
  onClose,
}: {
  gameId: string;
  token: string | null;
  players: PlayerInfo[];
  pendingSeats: Set<number>; // 还在回答上一个问题的 AI
  onClose: () => void;
}) {
  const ais = players.filter((p) => p.kind === 'ai');
  const [seat, setSeat] = useState<number>(ais[0]?.seat ?? 0);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = pendingSeats.has(seat);
  const canSend = !busy && !pending && question.trim().length > 0;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.debugAsk(gameId, seat, question.trim(), token ?? undefined);
      setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer debug">
      <div className="composer-head">
        <span className="composer-title">裁判提问（调试）</span>
        <select value={seat} onChange={(e) => setSeat(Number(e.target.value))}>
          {ais.map((p) => (
            <option key={p.seat} value={p.seat}>
              {p.seat}号 {p.name}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <button className="link" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="muted small-text">
        AI 在一个临时 fork 的会话里回答：记得游戏里的一切，但回答不进入游戏，其他 AI 也看不到。可以问它为什么这样发言、这样想。
      </div>
      <textarea
        autoFocus
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="比如：你第二轮为什么投反对？你现在觉得谁是梅林？"
        rows={3}
        maxLength={800}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) void send();
        }}
      />
      <div className="composer-foot">
        {error && <span className="error-text">{error}</span>}
        {pending && <span className="muted hint">它还在回答上一个问题</span>}
        <div className="spacer" />
        <span className="muted hint">⌘/Ctrl + Enter 发送</span>
        <button className="primary" disabled={!canSend} onClick={send}>
          提问
        </button>
      </div>
    </div>
  );
}
