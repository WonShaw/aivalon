import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import type {
  ActionSubmission,
  CreateGameRequest,
  HumanSeatRequest,
  CreateGameResponse,
  GameSummary,
  StreamMessage,
  Viewer,
} from '../shared/types.ts';
import { STANDARD_SETUP, validateSetup } from '../shared/setup.ts';
import { Game } from './game/engine.ts';
import { GameStore, type GameRecord } from './game/store.ts';
import { messageVisible } from './game/visibility.ts';

const PORT = Number(process.env.AIVALON_API_PORT ?? 8787);
const WEB_DIST = join(import.meta.dirname, '..', 'dist', 'web');

const store = new GameStore();
const games = new Map<string, Game>(); // 本次进程里创建的对局

// 进程重启后，之前没跑完的对局已无法继续，标记为中止
for (const record of store.listRecords()) {
  if (record.status === 'running') {
    record.status = 'aborted';
    store.saveRecord(record);
  }
}

function recordSummary(r: GameRecord): GameSummary {
  return {
    id: r.id,
    createdAt: r.createdAt,
    status: r.status,
    winner: r.winner,
    players: r.players,
    hasHumans: Object.keys(r.humanTokens ?? {}).length > 0,
    setup: r.setup ?? STANDARD_SETUP,
  };
}

function runningGame(): Game | undefined {
  return [...games.values()].find((g) => g.record.status === 'running');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return (text ? JSON.parse(text) : {}) as T;
}

// 根据凭证决定观看者身份：有人类玩家的对局，只能以玩家身份观看
function resolveViewer(record: GameRecord, token: string | null): Viewer | null {
  const tokens = record.humanTokens ?? {};
  if (token) {
    const entry = Object.entries(tokens).find(([, t]) => t === token);
    return entry ? { kind: 'player', seat: Number(entry[0]) } : null;
  }
  return Object.keys(tokens).length === 0 ? { kind: 'spectator' } : null;
}

function stream(req: IncomingMessage, res: ServerResponse, id: string, token: string | null): void {
  const game = games.get(id);
  const record = game?.record ?? store.loadRecord(id);
  if (!record) return json(res, 404, { error: '对局不存在' });
  const viewer = resolveViewer(record, token);
  if (!viewer) return json(res, 403, { error: '这局有人类玩家参与，只能用玩家的专属链接查看' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (msg: StreamMessage) => {
    if (messageVisible(msg, viewer)) res.write(`data: ${JSON.stringify(msg)}\n\n`);
  };

  send({ kind: 'hello', viewer });
  send({ kind: 'game', summary: game?.summary() ?? recordSummary(record) });
  for (const event of game?.events ?? store.loadEvents(id)) send({ kind: 'event', event });

  if (!game) return; // 历史对局：回放完即可
  for (const { seat, action } of game.actingNow()) send({ kind: 'status', seat, action, active: true });
  if (viewer.kind === 'player') {
    const pending = game.pendingRequestFor(viewer.seat);
    if (pending) send({ kind: 'request', request: pending });
  }

  game.bus.on('message', send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    game.bus.off('message', send);
  });
}

async function createGame(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const running = runningGame();
  if (running) return json(res, 409, { error: '已有一局正在进行', id: running.id });

  const body = await readBody<Partial<CreateGameRequest>>(req);
  const setup = body.setup ?? STANDARD_SETUP;
  const setupError = validateSetup(setup);
  if (setupError) return json(res, 400, { error: setupError });

  const humans: HumanSeatRequest[] = (body.humans ?? []).map((h) => ({
    name: String(h?.name ?? '').trim().slice(0, 12),
    role: h?.role ?? 'random',
  }));
  if (humans.length > setup.length) return json(res, 400, { error: `最多 ${setup.length} 名人类玩家` });
  if (humans.some((h) => !h.name)) return json(res, 400, { error: '人类玩家的名字不能为空' });
  const validPrefs = new Set<string>(['random', 'good', 'evil', ...setup]);
  if (humans.some((h) => !validPrefs.has(h.role))) return json(res, 400, { error: '选择的身份不在本局配置里' });

  let game: Game;
  try {
    game = Game.create(store, { humans, setup });
  } catch (err) {
    return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
  games.set(game.id, game);
  void game.run();

  const response: CreateGameResponse = {
    summary: game.summary(),
    seats: Object.entries(game.record.humanTokens).map(([seat, token]) => ({
      seat: Number(seat),
      name: game.record.players.find((p) => p.seat === Number(seat))!.name,
      token,
    })),
  };
  json(res, 201, response);
}

async function act(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const game = games.get(id);
  if (!game || game.record.status !== 'running') return json(res, 404, { error: '对局未在进行' });
  const body = await readBody<{ token: string; submission: ActionSubmission }>(req);
  const seat = game.seatForToken(body.token);
  if (seat === null) return json(res, 403, { error: '凭证无效' });
  const error = game.submitHuman(seat, body.submission);
  if (error) return json(res, 400, { error });
  json(res, 200, { ok: true });
}

async function stop(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const game = games.get(id);
  if (!game || game.record.status !== 'running') return json(res, 404, { error: '对局未在进行' });
  const body = await readBody<{ token?: string }>(req);
  if (game.hasHumans && (!body.token || game.seatForToken(body.token) === null)) {
    return json(res, 403, { error: '只有参与这局的玩家可以结束对局' });
  }
  game.stop();
  json(res, 200, { ok: true });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(res: ServerResponse, pathname: string): void {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端尚未构建：开发时请运行 npm run dev 并打开 http://localhost:5180');
    return;
  }
  let file = normalize(join(WEB_DIST, pathname));
  if (!file.startsWith(WEB_DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(WEB_DIST, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/api/games' && req.method === 'GET') {
    return json(res, 200, store.listRecords().map((r) => games.get(r.id)?.summary() ?? recordSummary(r)));
  }
  if (path === '/api/games' && req.method === 'POST') return createGame(req, res);

  const m = /^\/api\/games\/([\w-]+)\/(stream|act|stop)$/.exec(path);
  if (m) {
    const [, id, op] = m;
    if (op === 'stream' && req.method === 'GET') return stream(req, res, id, url.searchParams.get('token'));
    if (op === 'act' && req.method === 'POST') return act(req, res, id);
    if (op === 'stop' && req.method === 'POST') return stop(req, res, id);
  }

  if (path.startsWith('/api/')) return json(res, 404, { error: 'not found' });
  serveStatic(res, path);
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: String(err) });
  });
});

server.listen(PORT, () => {
  console.log(`Aivalon server listening on http://localhost:${PORT}`);
});
