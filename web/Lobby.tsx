import { useEffect, useState } from 'react';
import {
  OPTIONAL_EVIL,
  PLAYER_COUNTS,
  PRESETS,
  buildSetup,
  describeSetup,
  maxEvilSpecials,
  type SetupOptions,
} from '../shared/setup.ts';
import {
  ROLE_NAME,
  type CreateGameResponse,
  type GameSummary,
  type HumanSeatRequest,
  type Role,
  type RolePreference,
} from '../shared/types.ts';
import { MAX_NAME_LENGTH, defaultHumanName, validateHumanNames } from '../shared/names.ts';
import { api, createGame, forgetGame, gameUrl, loadSeats, type SavedSeat } from './client.ts';

interface Props {
  onOpen: (gameId: string, token?: string) => void;
  onCreated: (res: CreateGameResponse) => void;
  created: { id: string; seats: SavedSeat[] } | null; // 刚创建的多人对局，需要展示各自的链接
}

const STATUS_LABEL = { running: '进行中', finished: '已结束', aborted: '已中止', error: '出错' } as const;

// 大厅表单记在本机浏览器里，下次打开沿用
const FORM_KEY = 'aivalon.lobbyForm';
interface LobbyForm {
  mode: 'ai' | 'human';
  options: SetupOptions;
  humans: HumanSeatRequest[];
}
const DEFAULT_FORM: LobbyForm = {
  mode: 'ai',
  options: PRESETS[8][0].options,
  humans: [{ name: defaultHumanName(0), role: 'random' }],
};

function loadForm(): LobbyForm {
  try {
    const form = { ...DEFAULT_FORM, ...JSON.parse(localStorage.getItem(FORM_KEY) ?? '{}') };
    // 早期保存的表单没有人数
    if (!PLAYER_COUNTS.includes(form.options.players)) form.options = { ...form.options, players: 8 };
    // 早期的默认名字"我"之类容易让 AI 误解，换成默认名
    form.humans = form.humans.map((h: HumanSeatRequest, i: number) =>
      h.name.trim() && validateHumanNames([h.name]) ? { ...h, name: defaultHumanName(i) } : h,
    );
    return form;
  } catch {
    return DEFAULT_FORM;
  }
}

function prefLabel(p: RolePreference): string {
  if (p === 'random') return '随机';
  if (p === 'good') return '正义方（随机）';
  if (p === 'evil') return '邪恶方（随机）';
  return ROLE_NAME[p];
}

export function Lobby({ onOpen, onCreated, created }: Props) {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [form, setForm] = useState<LobbyForm>(loadForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seats = loadSeats();
  const { mode, options, humans } = form;
  const setup = buildSetup(options);
  const prefOptions: RolePreference[] = ['random', 'good', 'evil', ...new Set(setup)];

  useEffect(() => {
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify(form));
    } catch {
      // 忽略
    }
  }, [form]);

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

  const update = (patch: Partial<LobbyForm>) => setForm((f) => ({ ...f, ...patch }));

  // 换配置后，已经不在配置里的身份选择改回随机
  const setOptions = (next: SetupOptions) => {
    const nextSetup = buildSetup(next);
    update({
      options: next,
      humans: humans.map((h) =>
        h.role in ROLE_NAME && !nextSetup.includes(h.role as Role) ? { ...h, role: 'random' } : h,
      ),
    });
  };
  // 换人数时套用该人数的第一个预设，并去掉多出来的人类座位
  const setPlayers = (n: number) => {
    const next = PRESETS[n][0].options;
    const nextSetup = buildSetup(next);
    update({
      options: next,
      humans: humans
        .slice(0, n)
        .map((h) => (h.role in ROLE_NAME && !nextSetup.includes(h.role as Role) ? { ...h, role: 'random' } : h)),
    });
  };
  const maxEvil = maxEvilSpecials(options.players);
  const toggleEvil = (r: Role) =>
    setOptions({ ...options, evil: options.evil.includes(r) ? options.evil.filter((x) => x !== r) : [...options.evil, r] });

  const setCount = (n: number) =>
    update({ humans: Array.from({ length: n }, (_, i) => humans[i] ?? { name: defaultHumanName(i), role: 'random' }) });
  const setHuman = (i: number, patch: Partial<HumanSeatRequest>) =>
    update({ humans: humans.map((h, j) => (j === i ? { ...h, ...patch } : h)) });

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const req = { setup, humans: mode === 'ai' ? [] : humans.map((h) => ({ ...h, name: h.name.trim() })) };
      onCreated(await createGame(req));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const [deleting, setDeleting] = useState<string | null>(null);
  const remove = async (g: GameSummary) => {
    const when = new Date(g.createdAt).toLocaleString();
    if (!confirm(`删除 ${when} 的这局？\n对局记录和 AI 的会话记录都会被删除，无法恢复。`)) return;
    setDeleting(g.id);
    try {
      await api.deleteGame(g.id);
      forgetGame(g.id);
      setGames((list) => list.filter((x) => x.id !== g.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  };

  // 删除全部：进行中的对局（包括正在赛后交流的）保留
  const [deletingAll, setDeletingAll] = useState(false);
  const deletable = games.filter((g) => g.status !== 'running' && g.postgame !== 'running');
  const removeAll = async () => {
    const kept = games.length - deletable.length;
    const note = kept ? `\n进行中的 ${kept} 局会保留。` : '';
    if (!confirm(`删除全部 ${deletable.length} 局对局记录？\n对局记录和 AI 的会话记录都会被删除，无法恢复。${note}`)) return;
    setDeletingAll(true);
    try {
      const { deleted } = await api.deleteAllGames();
      deleted.forEach(forgetGame);
      setGames((list) => list.filter((x) => !deleted.includes(x.id)));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingAll(false);
    }
  };

  const nameError = mode === 'human' ? validateHumanNames(humans.map((h) => h.name)) : null;
  const running = games.find((g) => g.status === 'running');
  const sameOptions = (a: SetupOptions) => buildSetup(a).join() === setup.join();

  return (
    <div className="lobby">
      <div className="hero">
        <div className="brand">AIVALON</div>
        <div className="tagline">AI 玩家的阿瓦隆 · 也欢迎人类入座</div>
      </div>

      <section className="card">
        <h2>新开一局</h2>
        <div className="mode-switch">
          <button className={mode === 'ai' ? 'active' : ''} onClick={() => update({ mode: 'ai' })}>
            观战：全 AI 对局
            <span>可以看到所有身份、任务牌和 AI 的思考摘要</span>
          </button>
          <button className={mode === 'human' ? 'active' : ''} onClick={() => update({ mode: 'human' })}>
            入座：和 AI 一起玩
            <span>你只能看到公开信息和自己的身份信息</span>
          </button>
        </div>

        <div className="setup">
          <div className="setup-head">
            <span className="setup-label">人数</span>
            <div className="segmented">
              {PLAYER_COUNTS.map((n) => (
                <button key={n} className={options.players === n ? 'active' : ''} onClick={() => setPlayers(n)}>
                  {n} 人
                </button>
              ))}
            </div>
          </div>
          <div className="setup-label">身份配置</div>
          <div className="presets">
            {PRESETS[options.players].map((p) => (
              <button key={p.name} className={sameOptions(p.options) ? 'active' : ''} onClick={() => setOptions(p.options)}>
                {p.name}
                <span>{p.description}</span>
              </button>
            ))}
          </div>
          <div className="setup-options">
            <label>
              <input
                type="checkbox"
                checked={options.percival}
                onChange={(e) => setOptions({ ...options, percival: e.target.checked })}
              />
              派西维尔<span className="muted">（顶替一名忠臣）</span>
            </label>
            <span className="setup-sep" />
            <span className="muted">邪恶方特殊身份（最多 {maxEvil} 个，其余为爪牙）：</span>
            {OPTIONAL_EVIL.map((r) => (
              <label key={r}>
                <input
                  type="checkbox"
                  checked={options.evil.includes(r)}
                  disabled={!options.evil.includes(r) && options.evil.length >= maxEvil}
                  onChange={() => toggleEvil(r)}
                />
                {ROLE_NAME[r]}
              </label>
            ))}
          </div>
          <div className="setup-summary">{describeSetup(setup)}</div>
          {options.evil.includes('morgana') && !options.percival && (
            <div className="muted small-text">没有派西维尔时，莫甘娜没有可以迷惑的人，相当于普通坏人。</div>
          )}
        </div>

        {mode === 'human' && (
          <div className="humans">
            <label>
              人类玩家人数
              <select value={humans.length} onChange={(e) => setCount(Number(e.target.value))}>
                {Array.from({ length: options.players }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="human-rows">
              {humans.map((h, i) => (
                <div key={i} className="human-row">
                  <input
                    value={h.name}
                    maxLength={MAX_NAME_LENGTH}
                    placeholder={`${defaultHumanName(i)} 的名字`}
                    onChange={(e) => setHuman(i, { name: e.target.value })}
                  />
                  <select value={h.role} onChange={(e) => setHuman(i, { role: e.target.value as RolePreference })}>
                    {prefOptions.map((p) => (
                      <option key={p} value={p}>
                        身份：{prefLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="muted small-text">
              座位随机分配。{humans.length > 1 && '创建后会为每位人类玩家生成专属链接，发给对应的人即可；'}
              选择的身份只有本人知道。
            </div>
            {nameError && <div className="error-text">{nameError}</div>}
          </div>
        )}

        <div className="row">
          <button className="primary" disabled={busy || !!running || !!nameError} onClick={start}>
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
        <div className="card-head">
          <h2>对局记录</h2>
          {deletable.length > 0 && (
            <button className="ghost danger" disabled={deletingAll} onClick={removeAll} title="删除全部对局记录和 AI 会话记录">
              {deletingAll ? '删除中…' : '全部删除'}
            </button>
          )}
        </div>
        {games.length === 0 && <div className="muted">还没有对局。</div>}
        <div className="game-list">
          {games.map((g) => {
            const mine = seats[g.id];
            const humanCount = g.players.filter((p) => p.kind === 'human').length;
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
                    {humanCount ? `${humanCount} 名人类玩家` : '全 AI'} · {describeSetup(g.setup)}
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
                  {g.status !== 'running' && (
                    <button
                      className="ghost danger"
                      disabled={deleting === g.id}
                      onClick={() => remove(g)}
                      title="删除这局的对局记录和 AI 会话记录"
                    >
                      {deleting === g.id ? '删除中…' : '删除'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
