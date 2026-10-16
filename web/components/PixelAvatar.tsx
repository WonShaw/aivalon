import { memo, type ReactElement } from 'react';
import { BASE_PALETTE, avatarDef } from '../../shared/avatars.ts';
import type { Sprite } from '../sprites.ts';

// 把像素图画成 SVG：同一行里连续同色的像素合成一个矩形，"." 透明
export const PixelArt = memo(function PixelArt({ sprite, label, className }: { sprite: Sprite; label?: string; className?: string }) {
  const { rows, palette } = sprite;
  const w = rows[0]?.length ?? 0;
  const rects: ReactElement[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      let n = 1;
      while (x + n < row.length && row[x + n] === row[x]) n++;
      if (row[x] !== '.') rects.push(<rect key={`${x},${y}`} x={x} y={y} width={n} height={1} fill={palette[row[x]]} />);
      x += n;
    }
  });
  return (
    <svg
      className={className ?? 'pixel-art'}
      viewBox={`0 0 ${w} ${rows.length}`}
      shapeRendering="crispEdges"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {rects}
    </svg>
  );
});

// 两帧的像素动画：两帧叠在一起，用 CSS 轮流显示（见 styles.css 的 .frames）
export function PixelFrames({ frames, className }: { frames: Sprite[]; className?: string }) {
  return (
    <span className={`frames${className ? ` ${className}` : ''}`}>
      {frames.map((f, i) => (
        <PixelArt key={i} sprite={f} className={`pixel-art frame-${i}`} />
      ))}
    </span>
  );
}

// 玩家头像，背景透明，透出外框（座位颜色）
export const PixelAvatar = memo(function PixelAvatar({ id }: { id: string }) {
  const def = avatarDef(id);
  return <PixelArt sprite={{ rows: def.rows, palette: { ...BASE_PALETTE, ...def.palette } }} label={def.name} className="pixel-avatar" />;
});
