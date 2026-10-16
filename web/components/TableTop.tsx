import { memo, useMemo, type ReactElement } from 'react';
import type { TableMood } from '../sprites.ts';

// 圆桌桌面：仿温彻斯特圆桌，绿、米两色的扇形从中心放射，每块正对一个座位。按 128×128 的像素格子画
// （一格和头像的一个像素差不多大，风格才统一），桌沿是阶梯状的像素圆，外圈一圈木框和黄铜铆钉，
// 中间一块深色圆牌放任务地图和提名（文字在上面读得清）。
// 队长的扇形亮金色，被提名的人的扇形提亮，把座位和桌子中央连起来。
// 刺杀阶段扇形变成暗红，游戏结束后染成获胜一方的颜色

const G = 128; // 格子数
const C = G / 2; // 圆心
const R = C; // 桌面半径（格）
const RIM = 7; // 木框宽度（格）
const PLAQUE = 43; // 中间圆牌的半径（格）

const COLOR = {
  outline: '#120e09',
  rimLight: '#6b4a2e', // 木框上半圈的高光，像光从上面照下来
  rim: '#4a3220',
  rimGrain: '#432d1d',
  rimJoint: '#2e1f14',
  rimShadow: '#24180f',
  rivetLight: '#f0d27a',
  rivet: '#c9a24a',
  rivetDark: '#7a5a22',
  separator: '#15110b',
  greenTeam: '#3a6544',
  creamTeam: '#6a5c3a',
  leader: '#5c4a1e',
  leaderTeam: '#715a22',
  plaqueShadow: '#120e09',
  plaqueBorder: '#6b5a3a',
  plaqueRing: '#2c261b',
  plaque: '#211c14',
};

// 扇形的两种底色，按阶段换
const WEDGE: Record<TableMood, [string, string]> = {
  normal: ['#203528', '#3a3324'],
  blood: ['#331a1c', '#3d2620'],
  good: ['#1b2a45', '#2c3650'],
  evil: ['#3b1719', '#4a221f'],
};

interface Props {
  seats: number; // 人数
  leader: number | null;
  team: number[]; // 提名的队伍（或者你正在选的）
  mood: TableMood;
}

// 格子到一组放射线（角度间隔 step，从 start 开始）的最近垂直距离，用来画一格宽的分界线、木框接缝
function distToSpokes(dx: number, dy: number, start: number, step: number): number {
  const d = Math.hypot(dx, dy);
  const pos = (Math.atan2(dy, dx) - start) / step;
  const from = pos - Math.floor(pos); // 离上一条线多远（单位：间隔），0 到 1
  return d * Math.sin((from < 0.5 ? from : from - 1) * step);
}

// 分界线正好落在两行格子中间时（水平、竖直的线）只取一行，不会变成两格粗；留一点余量避免浮点误差
const onLine = (perp: number) => perp >= -0.501 && perp < 0.499;

export const TableTop = memo(function TableTop({ seats, leader, team, mood }: Props) {
  const teamKey = team.join(',');
  const rects = useMemo(() => {
    const inTeam = new Set(teamKey ? teamKey.split(',').map(Number) : []);
    const wedge = (2 * Math.PI) / seats;
    const top = -Math.PI / 2;

    // 每个座位两颗 2×2 的铆钉，落在扇形的正中和分界线上；左上角高光、右下角暗部
    const rivets = new Map<string, string>();
    for (let k = 0; k < seats * 2; k++) {
      const a = top + (k * wedge) / 2;
      const x = Math.round(C + (R - RIM / 2 - 0.5) * Math.cos(a) - 1);
      const y = Math.round(C + (R - RIM / 2 - 0.5) * Math.sin(a) - 1);
      rivets.set(`${x},${y}`, COLOR.rivetLight);
      rivets.set(`${x + 1},${y}`, COLOR.rivet);
      rivets.set(`${x},${y + 1}`, COLOR.rivet);
      rivets.set(`${x + 1},${y + 1}`, COLOR.rivetDark);
    }

    const colorAt = (x: number, y: number): string | null => {
      const dx = x + 0.5 - C;
      const dy = y + 0.5 - C;
      const d = Math.hypot(dx, dy);
      if (d > R) return null;
      if (d > R - 1) return COLOR.outline;
      // 木框：铆钉、上半圈高光、接缝（每个座位三段木板）、细木纹
      if (d > R - RIM) {
        const rivet = rivets.get(`${x},${y}`);
        if (rivet) return rivet;
        if (d > R - 2) return dy < 0 ? COLOR.rimLight : COLOR.rim;
        if (onLine(distToSpokes(dx, dy, top + wedge / 4, wedge / 2))) return COLOR.rimJoint;
        return Math.floor(d) % 3 === 0 ? COLOR.rimGrain : COLOR.rim;
      }
      if (d > R - RIM - 1) return COLOR.rimShadow;
      // 中间圆牌：外面一圈阴影，像放在桌面上
      if (d <= PLAQUE + 1) {
        if (d > PLAQUE) return COLOR.plaqueShadow;
        if (d > PLAQUE - 1) return COLOR.plaqueBorder;
        if (d > PLAQUE - 3) return COLOR.plaqueRing;
        return COLOR.plaque;
      }
      // 扇形：座位 1 在正上方，顺时针排列，和座位的位置一致
      if (onLine(distToSpokes(dx, dy, top + wedge / 2, wedge))) return COLOR.separator;
      const i = ((Math.round((Math.atan2(dy, dx) - top) / wedge) % seats) + seats) % seats;
      const seat = i + 1;
      const t = inTeam.has(seat);
      if (seat === leader) return t ? COLOR.leaderTeam : COLOR.leader;
      if (i % 2 === 0) return t ? COLOR.greenTeam : WEDGE[mood][0];
      return t ? COLOR.creamTeam : WEDGE[mood][1];
    };

    const out: ReactElement[] = [];
    for (let y = 0; y < G; y++) {
      let x = 0;
      let c = colorAt(0, y);
      while (x < G) {
        let n = 1;
        let next: string | null = null;
        while (x + n < G && (next = colorAt(x + n, y)) === c) n++;
        if (c) out.push(<rect key={`${x},${y}`} x={x} y={y} width={n} height={1} fill={c} />);
        x += n;
        c = next;
      }
    }
    return out;
  }, [seats, leader, teamKey, mood]);

  return (
    <svg className="table-top" viewBox={`0 0 ${G} ${G}`} shapeRendering="crispEdges" aria-hidden>
      {rects}
    </svg>
  );
});
