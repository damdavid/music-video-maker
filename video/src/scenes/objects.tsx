import type { SafeNode } from "./safeSvg";
import { renderSafe, viewBoxOf } from "./freeform";

/** A custom object drawn from its sanitized SVG, resting on the ground line at (x, y) and `size` tall. */
export const ObjectArt = ({ art, uid, x, y, size }: { art: SafeNode; uid: string; x: number; y: number; size: number }) => {
  const [minX, minY, vbW, vbH] = viewBoxOf(art, [0, 0, 200, 200]);
  return (
    <g transform={`translate(${x} ${y}) scale(${size / vbH}) translate(${-(minX + vbW / 2)} ${-(minY + vbH)})`}>
      {art.children.map((c, i) => renderSafe(c, i, `${uid}-`))}
    </g>
  );
};
