import { mix } from "../color";
import type { PropKind } from "./normalize";
import type { SceneColors } from "./sky";

type Props = {
  kind: PropKind;
  x: number;
  gy: number;
  unit: number;
  c: SceneColors;
  t: number;
  /** Beat envelope (1 on a beat): lit lamps swell with it. */
  pulse: number;
  /** Degrees a tree leans in the wind right now. */
  sway: number;
};

/** Ground-standing set dressing. `unit` is one figure-height in pixels; `gy` is the ground line. */
export const PropShape = ({ kind, x, gy, unit, c, t, pulse, sway }: Props) => {
  const lit = c.time === "night" || c.time === "dusk";
  switch (kind) {
    case "lamp": {
      const hgt = unit * 0.86;
      return (
        <g transform={`translate(${x} ${gy})`}>
          {lit && <polygon points={`${-unit * 0.04},${-hgt} ${unit * 0.04},${-hgt} ${unit * 0.3},0 ${-unit * 0.3},0`} fill={c.light} opacity={0.1 + 0.015 * Math.sin(t * 3) + 0.05 * pulse} />}
          {lit && <circle cx={0} cy={-hgt} r={unit * (0.2 + 0.03 * pulse)} fill={c.light} opacity={0.22 + 0.1 * pulse} />}
          <rect x={-unit * 0.009} y={-hgt} width={unit * 0.018} height={hgt} fill={c.ink} />
          <rect x={-unit * 0.06} y={-hgt - unit * 0.02} width={unit * 0.12} height={unit * 0.03} rx={unit * 0.01} fill={c.ink} />
          <circle cx={0} cy={-hgt + unit * 0.012} r={unit * 0.03} fill={lit ? c.light : mix(c.ink, c.fg, 0.4)} />
        </g>
      );
    }
    case "bench":
      return (
        <g transform={`translate(${x} ${gy})`} fill={c.ink}>
          <rect x={-unit * 0.17} y={-unit * 0.27} width={unit * 0.34} height={unit * 0.025} rx={unit * 0.008} />
          <rect x={-unit * 0.17} y={-unit * 0.45} width={unit * 0.34} height={unit * 0.02} rx={unit * 0.008} />
          <rect x={-unit * 0.17} y={-unit * 0.45} width={unit * 0.02} height={unit * 0.2} />
          <rect x={-unit * 0.15} y={-unit * 0.25} width={unit * 0.02} height={unit * 0.25} />
          <rect x={unit * 0.13} y={-unit * 0.25} width={unit * 0.02} height={unit * 0.25} />
        </g>
      );
    case "tree":
      return (
        <g transform={`translate(${x} ${gy}) rotate(${sway.toFixed(2)})`}>
          <rect x={-unit * 0.03} y={-unit * 0.5} width={unit * 0.06} height={unit * 0.5} fill={c.ink} />
          {[[0, -0.78, 0.26], [-0.16, -0.62, 0.2], [0.17, -0.64, 0.21]].map(([dx, dy, r], i) => <circle key={i} cx={dx * unit} cy={dy * unit} r={r * unit} fill={mix(c.near, c.ink, 0.2)} />)}
        </g>
      );
    case "house":
      return (
        <g transform={`translate(${x} ${gy})`}>
          <rect x={-unit * 0.2} y={-unit * 0.3} width={unit * 0.4} height={unit * 0.3} fill={mix(c.mid, c.ink, 0.35)} />
          <polygon points={`${-unit * 0.25},${-unit * 0.3} ${unit * 0.25},${-unit * 0.3} 0,${-unit * 0.5}`} fill={c.ink} />
          <rect x={-unit * 0.13} y={-unit * 0.22} width={unit * 0.09} height={unit * 0.09} fill={lit ? c.light : mix(c.mid, c.fg, 0.4)} opacity={lit ? 0.9 : 1} />
          <rect x={unit * 0.04} y={-unit * 0.17} width={unit * 0.08} height={unit * 0.17} fill={c.ink} />
        </g>
      );
    case "suitcase":
      return (
        <g transform={`translate(${x} ${gy})`}>
          <rect x={-unit * 0.05} y={-unit * 0.17} width={unit * 0.1} height={unit * 0.017} fill="none" stroke={c.ink} strokeWidth={unit * 0.012} />
          <rect x={-unit * 0.09} y={-unit * 0.14} width={unit * 0.18} height={unit * 0.14} rx={unit * 0.012} fill={mix(c.near, c.light, 0.25)} />
          <rect x={-unit * 0.09} y={-unit * 0.08} width={unit * 0.18} height={unit * 0.012} fill={c.ink} />
        </g>
      );
  }
};
