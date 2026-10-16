import { memo, type ReactElement } from 'react';
import { AVATAR_SIZE, BASE_PALETTE, avatarDef } from '../../shared/avatars.ts';

// 把像素图画成 SVG：同一行里连续同色的像素合成一个矩形。背景透明，透出外框（座位颜色）
export const PixelAvatar = memo(function PixelAvatar({ id }: { id: string }) {
  const def = avatarDef(id);
  const palette = { ...BASE_PALETTE, ...def.palette };
  const rects: ReactElement[] = [];
  def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      let w = 1;
      while (x + w < row.length && row[x + w] === row[x]) w++;
      if (row[x] !== '.') rects.push(<rect key={`${x},${y}`} x={x} y={y} width={w} height={1} fill={palette[row[x]]} />);
      x += w;
    }
  });
  return (
    <svg className="pixel-avatar" viewBox={`0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}`} shapeRendering="crispEdges" role="img" aria-label={def.name}>
      {rects}
    </svg>
  );
});
