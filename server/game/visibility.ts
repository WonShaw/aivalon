import type { GameEvent, StreamMessage, Viewer } from '../../shared/types.ts';

// gameOver：对局正常结束后，玩家也能看到 AI 的思考摘要。这里只决定推给网页的内容，
// AI 的上下文由 engine.ts 的 visibleTo 单独过滤，看不到思考摘要
export function eventVisible(e: GameEvent, viewer: Viewer, gameOver = false): boolean {
  if (viewer.kind === 'spectator') return true;
  if (gameOver && e.type === 'thought') return true;
  return e.visibility.kind === 'public' || (e.visibility.kind === 'players' && e.visibility.seats.includes(viewer.seat));
}

// 服务端按观看者过滤推送内容：人类玩家只能收到公开信息和属于自己的信息
export function messageVisible(msg: StreamMessage, viewer: Viewer, gameOver = false): boolean {
  switch (msg.kind) {
    case 'hello':
    case 'game':
      return true;
    case 'event':
      return eventVisible(msg.event, viewer, gameOver);
    case 'live':
      return true; // 正在生成的公开发言
    case 'status':
      // 出任务牌的快慢可能暴露阵营，只让玩家看到自己的出牌状态
      return viewer.kind === 'spectator' || msg.action !== 'mission' || msg.seat === viewer.seat;
    case 'request':
    case 'request_done':
      return viewer.kind === 'player' && viewer.seat === (msg.kind === 'request' ? msg.request.seat : msg.seat);
  }
}
