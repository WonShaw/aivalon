import { useEffect, useMemo, useState } from 'react';
import { describeAIConfig } from '../shared/ai.ts';
import { avatarOf } from '../shared/avatars.ts';
import { seesEverything, type CreateGameResponse, type GameStatus } from '../shared/types.ts';
import { api, createGame, loadRequest } from './client.ts';
import { ChatComposer, Composer, TableActions, useHumanAction, usePostgameChat } from './components/ActionPanel.tsx';
import { DebugAsk } from './components/DebugPanel.tsx';
import { RoleGuide } from './components/RoleGuide.tsx';
import { RoundTable, TableLegend } from './components/RoundTable.tsx';
import { Timeline } from './components/Timeline.tsx';
import { deriveBoard, visibleRoles } from './derive.ts';
import { playerName, roleLabel, roleTone } from './format.ts';
import { useGuesses } from './guesses.ts';
import { useGameStream } from './useGameStream.ts';
import { VOICE_RATES, useCaughtUpValue, usePlayback, useVoiceRate } from './voice.ts';

const STATUS_LABEL: Record<GameStatus, string> = {
  running: '进行中',
  finished: '已结束',
  aborted: '已中止',
  error: '出错',
};

function usePersistentToggle(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v === '1';
    } catch {
      return initial;
    }
  });
  const set = (v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(key, v ? '1' : '0');
    } catch {
      // 忽略
    }
  };
  return [value, set];
}

interface Props {
  gameId: string;
  token: string | null;
  onBack: () => void;
  onCreated: (res: CreateGameResponse) => void;
}

export function GameView({ gameId, token, onBack, onCreated }: Props) {
  const state = useGameStream(gameId, token);
  const [godView, setGodView] = usePersistentToggle('aivalon.godView', true);
  const [voiceOn, setVoiceOn] = usePersistentToggle('aivalon.voice', true);
  const [voiceRate, setVoiceRate] = useVoiceRate();
  // 开启朗读时，事件按朗读进度一条条显示；落后时对局状态、谁在行动、轮到你的操作都等追上了再显示
  // 上帝视角下时间线显示每张任务牌，朗读也跟着读出来
  // 调试模式和暂停直接用最新状态，不等朗读追上
  const debug = !!state.summary?.debug;
  const paused = !!state.summary?.paused;
  const voiceGodView = godView && !!state.viewer && !!state.summary && seesEverything(state.viewer, state.summary.status, debug);
  const voice = usePlayback(state, voiceOn, voiceRate, voiceGodView);
  const viewer = state.viewer;
  const events = voice.events;
  const summary = useCaughtUpValue(state.summary, voice.caughtUp);
  const acting = voice.caughtUp ? state.acting : {};
  const live = voice.caughtUp ? state.live : {};
  const request = voice.caughtUp ? state.request : null;
  const board = useMemo(() => deriveBoard(events, viewer), [events, viewer]);

  const isSpectator = viewer?.kind === 'spectator';
  // 观众、对局正常结束后的玩家、调试模式下的所有人：能看到调用统计，可以开上帝视角看所有身份、任务牌和思考摘要（服务端也按同一规则推送）
  const fullView = !!viewer && !!summary && seesEverything(viewer, summary.status, debug);
  const players = summary?.players ?? [];
  const mySeat = viewer?.kind === 'player' ? viewer.seat : null;
  const roles = visibleRoles(board, viewer, godView);
  const [guesses, setGuess] = useGuesses(gameId, mySeat ? `seat${mySeat}` : 'spectator');
  const canMark = players.some((p) => p.seat !== mySeat && !roles[p.seat]);
  const act = useHumanAction(gameId, token, request, players);
  // 轮到你时在标签页标题上提示，切到别的页面也能看到
  const yourTurn = !!act;
  useEffect(() => {
    if (!yourTurn) return;
    const title = document.title;
    document.title = `【轮到你】${title}`;
    return () => {
      document.title = title;
    };
  }, [yourTurn]);

  const [restarting, setRestarting] = useState(false);
  const humanNames = players.filter((p) => p.kind === 'human').map((p) => p.name);
  const setup = summary?.setup ?? [];

  // 用相同的配置再开一局：同样的身份配置、AI 配置和人类玩家（座位重新随机）。
  // 人类选的身份只有创建者的浏览器记得，其他人点"再来一局"时身份改为随机
  const playAgain = async () => {
    setRestarting(true);
    try {
      const saved = loadRequest(gameId);
      const req = saved
        ? { ...saved, ai: saved.ai ?? summary?.ai }
        : {
            setup,
            ai: summary?.ai,
            humans: players.filter((p) => p.kind === 'human').map((p) => ({ name: p.name, role: 'random' as const, avatar: avatarOf(p) })),
          };
      onCreated(await createGame(req));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRestarting(false);
    }
  };
  const postgameRunning = summary?.postgame === 'running';
  const playAgainButton = summary && summary.status !== 'running' && !postgameRunning && (
    <button className="primary" disabled={restarting} onClick={playAgain}>
      {restarting ? '创建中…' : humanNames.length > 1 ? '再来一局（生成新链接）' : '再来一局'}
    </button>
  );

  // 赛后交流：正常结束的对局可以手动开启，一轮结束后还能再开一轮；全 AI 对局观众可开，有人类的对局由玩家开
  const [startingPostgame, setStartingPostgame] = useState(false);
  const canStartPostgame =
    summary?.status === 'finished' && summary.postgame !== 'running' && (isSpectator || !!token);
  const postgameAgain = summary?.postgame === 'done';
  const startPostgame = async () => {
    setStartingPostgame(true);
    try {
      await api.startPostgame(gameId, token ?? undefined);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setStartingPostgame(false);
    }
  };
  const postgameButton = canStartPostgame && (
    <button
      disabled={startingPostgame}
      onClick={startPostgame}
      title={postgameAgain ? '每位玩家按座位顺序再发言一次' : '每位玩家再发言一次，聊聊这局的感想'}
    >
      {startingPostgame ? '开启中…' : postgameAgain ? '再聊一轮' : '赛后聊聊'}
    </button>
  );

  // 赛后单独对话：正常结束的对局，人类玩家可以在圆桌上选一名 AI 对话。正在轮流发言时先让位给发言框
  const aiSeats = players.filter((p) => p.kind === 'ai' && p.seat !== mySeat).map((p) => p.seat);
  const canChat = summary?.status === 'finished' && !!mySeat && !!token && aiSeats.length > 0;
  const [chatOpen, setChatOpen] = useState(false);
  const chat = usePostgameChat(gameId, token, aiSeats, postgameRunning);
  const chatting = canChat && chatOpen && !act;
  const chatButton = canChat && !chatOpen && !postgameRunning && (
    <button onClick={() => setChatOpen(true)} title="选一名 AI 单独聊聊，对话是公开的">
      单独聊聊
    </button>
  );

  // 调试模式：全 AI 对局的观众和参与对局的玩家可以开关。开了以后本局所有人都能看到全部身份和 AI 的思考，
  // 可以暂停 AI 调用，也可以以裁判身份向 AI 提问
  const canDebug = isSpectator || !!token;
  const liveBusy = state.summary?.status === 'running' || state.summary?.postgame === 'running';
  const [askOpen, setAskOpen] = useState(false);
  // 还在回答调试提问的 AI（用最新的事件，不等朗读）
  const debugPending = useMemo(() => {
    const answered = new Set(state.events.flatMap((e) => (e.type === 'debug_answer' ? [e.id] : [])));
    return new Set(state.events.flatMap((e) => (e.type === 'debug_ask' && !answered.has(e.id) ? [e.seat] : [])));
  }, [state.events]);
  const toggleDebug = async (on: boolean) => {
    if (on && summary?.hasHumans && !confirm('开启调试模式后，本局所有玩家都能看到全部身份和 AI 的思考，确定开启吗？')) return;
    try {
      await api.setDebug(gameId, on, token ?? undefined);
      if (!on) setAskOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };
  const togglePaused = async (on: boolean) => {
    try {
      await api.setPaused(gameId, on, token ?? undefined);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const stop = async () => {
    if (!confirm(postgameRunning ? '确定要结束赛后交流吗？' : '确定要结束这局游戏吗？')) return;
    try {
      await api.stop(gameId, token ?? undefined);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="game">
      <header className="topbar">
        <button className="link" onClick={onBack}>
          ← 大厅
        </button>
        <div className="brand small">AIVALON</div>
        {summary && <span className={`pill ${summary.status}`}>{STATUS_LABEL[summary.status]}</span>}
        <span className="muted mode">
          {isSpectator ? '观战 · 全 AI 对局' : mySeat ? `你是 ${mySeat}号 ${playerName(players, mySeat)}` : ''}
        </span>
        {summary?.ai && <span className="muted mode">{describeAIConfig(summary.ai)}</span>}
        <div className="spacer" />
        {voice.supported && (
          <span className="voice">
            <label className="toggle" title="用浏览器自带的语音读出发言和流程（只读开启后的新内容）">
              <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} />
              语音朗读
            </label>
            {voiceOn && (
              <>
                <select value={voiceRate} onChange={(e) => setVoiceRate(Number(e.target.value))} title="朗读语速">
                  {VOICE_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
                {!voice.hasChinese && <span className="muted">未找到中文语音</span>}
                {voice.blocked && <span className="warn">点击页面任意处开始朗读</span>}
                {voice.pending > 0 && (
                  <button className="link" onClick={voice.skipToLatest} title="跳过积压的内容，只读最新一条">
                    落后 {voice.pending} 条 · 跳到最新
                  </button>
                )}
              </>
            )}
          </span>
        )}
        {fullView && (
          <label className="toggle">
            <input type="checkbox" checked={godView} onChange={(e) => setGodView(e.target.checked)} />
            上帝视角
          </label>
        )}
        {canDebug && (
          <label className={`toggle${debug ? ' debug-on' : ''}`} title="所有人的身份和 AI 的思考都公开，可以暂停、以裁判身份向 AI 提问">
            <input type="checkbox" checked={debug} onChange={(e) => toggleDebug(e.target.checked)} />
            调试
          </label>
        )}
        {debug && canDebug && liveBusy && (
          <label className={`toggle${paused ? ' paused' : ''}`} title="已经开始的 AI 调用会完成，之后不再发起新的调用，直到继续">
            <input type="checkbox" checked={paused} onChange={(e) => togglePaused(e.target.checked)} />
            暂停
          </label>
        )}
        {debug && canDebug && !askOpen && <button onClick={() => setAskOpen(true)}>裁判提问</button>}
        {summary?.status === 'running' && (
          <button className="ghost danger" onClick={stop}>
            结束对局
          </button>
        )}
        {postgameRunning && (
          <button className="ghost danger" onClick={stop}>
            结束赛后交流
          </button>
        )}
        {postgameButton}
        {chatButton}
        {playAgainButton}
      </header>

      {state.error && <div className="notice">{state.error}</div>}
      {debug && paused && liveBusy && (
        <div className="notice paused-notice">已暂停：已经开始的 AI 调用会完成，之后不再发起新的调用。取消勾选"暂停"后继续。</div>
      )}

      {summary ? (
        <div className="game-body">
          <section className="stage">
            <aside className="stage-info">
              {board.myRole && (
                <div className={`role-card ${roleTone(board.myRole.role)}`}>
                  <div className="role-card-title">你的身份：{roleLabel(board.myRole.role)}</div>
                  <div>{board.myRole.knowledge}</div>
                </div>
              )}

              <RoleGuide setup={setup} roles={roles} nightMarks={board.myRole?.marks ?? []} guesses={guesses} canMark={canMark} />
              <TableLegend />

              {fullView && board.usage.calls > 0 && (
                <div className="stats">
                  <div>
                    <span className="muted">AI 调用</span> {board.usage.calls} 次
                  </div>
                  <div>
                    <span className="muted">估算费用</span> ${board.usage.costUsd.toFixed(2)}
                  </div>
                  <div>
                    <span className="muted">输出 token</span> {board.usage.output.toLocaleString()}
                  </div>
                  <div>
                    <span className="muted">缓存命中</span>{' '}
                    {Math.round((board.usage.cacheRead / Math.max(1, board.usage.cacheRead + board.usage.cacheWrite + board.usage.input)) * 100)}%
                  </div>
                </div>
              )}
            </aside>

            <div className="stage-main">
              <div className="stage-table">
                <RoundTable
                  setup={setup}
                  players={players}
                  board={board}
                  acting={acting}
                  speaking={voiceOn ? voice.speakingSeat : null}
                  viewer={viewer}
                  roles={roles}
                  guesses={guesses}
                  onGuess={setGuess}
                  pick={act?.pick ?? (chatting ? chat.pick : null)}
                  actions={<TableActions act={act} />}
                />
              </div>
            </div>
          </section>

          <main className="subtitles">
            <Timeline
              events={events}
              players={players}
              viewer={viewer}
              fullView={fullView}
              godView={godView}
              roles={roles}
              acting={acting}
              live={live}
              readingSeq={voiceOn ? voice.reading : null}
              speakingSeat={voiceOn ? voice.speakingSeat : null}
            >
              {(postgameButton || chatButton || playAgainButton) && (
                <div className="play-again">
                  {postgameButton}
                  {chatButton}
                  {playAgainButton}
                </div>
              )}
            </Timeline>
            {/* 发言框固定在时间线下方，不挡圆桌 */}
            {act?.allowsSpeech && <Composer key={act.request.id} act={act} />}
            {chatting && <ChatComposer chat={chat} players={players} onClose={() => setChatOpen(false)} />}
            {debug && canDebug && askOpen && (
              <DebugAsk gameId={gameId} token={token} players={players} pendingSeats={debugPending} onClose={() => setAskOpen(false)} />
            )}
          </main>
        </div>
      ) : (
        !state.error && <div className="notice">连接中…</div>
      )}
    </div>
  );
}
