import type { ActionSubmission, CreateGameResponse, GameSummary } from '../shared/types.ts';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `请求失败（${res.status}）`);
  return body as T;
}

export const api = {
  listGames: () => request<GameSummary[]>('/api/games'),
  createGame: (humans: string[]) =>
    request<CreateGameResponse>('/api/games', { method: 'POST', body: JSON.stringify({ humans }) }),
  act: (id: string, token: string, submission: ActionSubmission) =>
    request<{ ok: true }>(`/api/games/${id}/act`, { method: 'POST', body: JSON.stringify({ token, submission }) }),
  stop: (id: string, token?: string) =>
    request<{ ok: true }>(`/api/games/${id}/stop`, { method: 'POST', body: JSON.stringify({ token }) }),
};

// 人类玩家的凭证保存在本机浏览器里，方便回到对局
const TOKENS_KEY = 'aivalon.tokens';

export interface SavedSeat {
  seat: number;
  name: string;
  token: string;
}

export function loadSeats(): Record<string, SavedSeat[]> {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveSeats(gameId: string, seats: SavedSeat[]): void {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify({ ...loadSeats(), [gameId]: seats }));
  } catch {
    // 存不了也不影响游戏，只是回到大厅后找不到入口
  }
}

export function gameUrl(id: string, token?: string): string {
  const params = new URLSearchParams({ game: id });
  if (token) params.set('token', token);
  return `${location.origin}${location.pathname}?${params}`;
}
