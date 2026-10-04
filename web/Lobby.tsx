import { useEffect, useState } from 'react';
import type { CreateGameResponse, GameSummary } from '../shared/types.ts';
import { api, gameUrl, loadSeats, type SavedSeat } from './client.ts';

interface Props {
  onOpen: (gameId: string, token?: string) => void;
  onCreated: (res: CreateGameResponse) => void;
  created: { id: string; seats: SavedSeat[] } | null; // 刚创建的多人对局，需要展示各自的链接
}

const STATUS_LABEL = { running: '进行中', finished: '已结束', aborted: '已中止', error: '出错' } as const;

export function Lobby({ onOpen, onCreated, created }: Props) {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [mode, setMode] = useState<'ai' | 'human'>('ai');
  const [names, setNames] = useState<string[]>(['我']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seats = loadSeats();

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .listGames()
        .then((g) => alive && setGames(g))
        .catch(() => {});
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const setCount = (n: number) =>
    setNames((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? `玩家${i + 1}`));

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const humans = mode === 'ai' ? [] : names.map((n) => n.trim());
      onCreated(await api.createGame(humans));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const running = games.find((g) => g.status === 'running');

  return (
    <div className="lobby">
      <div className="hero">
        <div className="brand">AIVALON</div>
        <div className="tagline">8 位 AI 玩家的阿瓦隆 · 也欢迎人类入座</div>
      </div>

      <section className="card">
        <h2>新开一局</h2>
        <div className="mode-switch">
          <button className={mode === 'ai' ? 'active' : ''} onClick={() => setMode('ai')}>
            观战：8 个 AI 对局
            <span>可以看到所有身份、任务牌和 AI 的思考摘要</span>
          </button>
          <button className={mode === 'human' ? 'active' : ''} onClick={() => setMode('human')}>
            入座：和 AI 一起玩
            <span>你只能看到公开信息和自己的身份信息</span>
          </button>
        </div>

        {mode === 'human' && (
          <div className="humans">
            <label>
              人类玩家人数
              <select value={names.length} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="name-inputs">
              {names.map((n, i) => (
                <input
                  key={i}
                  value={n}
                  maxLength={12}
                  placeholder={`玩家${i + 1} 的名字`}
                  onChange={(e) => setNames((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                />
              ))}
            </div>
            {names.length > 1 && <div className="muted">创建后会为每位人类玩家生成专属链接，发给对应的人即可。</div>}
          </div>
        )}

        <div className="row">
          <button className="primary" disabled={busy || !!running} onClick={start}>
            {busy ? '创建中…' : '开始游戏'}
          </button>
          {running && <span className="muted">已有一局正在进行，结束后才能开新局。</span>}
        </div>
        {error && <div className="error-text">{error}</div>}

        {created && (
          <div className="links">
            <div className="muted">座位已随机分配。每个链接只能看到对应玩家的信息：</div>
            {created.seats.map((s) => (
              <div key={s.seat} className="link-row">
                <span>
                  {s.seat}号 · {s.name}
                </span>
                <input readOnly value={gameUrl(created.id, s.token)} onFocus={(e) => e.target.select()} />
                <button onClick={() => onOpen(created.id, s.token)}>进入</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>对局记录</h2>
        {games.length === 0 && <div className="muted">还没有对局。</div>}
        <div className="game-list">
          {games.map((g) => {
            const mine = seats[g.id];
            const humans = g.players.filter((p) => p.kind === 'human').length;
            return (
              <div key={g.id} className="game-row">
                <div>
                  <div>
                    {new Date(g.createdAt).toLocaleString()}
                    <span className={`pill ${g.status}`}>{STATUS_LABEL[g.status]}</span>
                    {g.winner && (
                      <span className={`badge small ${g.winner}`}>{g.winner === 'good' ? '正义方胜' : '邪恶方胜'}</span>
                    )}
                  </div>
                  <div className="muted small-text">
                    {humans ? `${humans} 名人类玩家` : '全 AI'} · {g.players.map((p) => p.name).join('、')}
                  </div>
                </div>
                <div className="row">
                  {!g.hasHumans && <button onClick={() => onOpen(g.id)}>{g.status === 'running' ? '观战' : '回放'}</button>}
                  {g.hasHumans &&
                    (mine?.length ? (
                      mine.map((s) => (
                        <button key={s.seat} onClick={() => onOpen(g.id, s.token)}>
                          进入 {s.seat}号 {s.name}
                        </button>
                      ))
                    ) : (
                      <span className="muted small-text">需要玩家专属链接</span>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
