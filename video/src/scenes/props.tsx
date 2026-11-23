import { mix } from "../color";
import type { PropKind } from "./normalize";
import type { SceneColors } from "./sky";
import { CALM, type SceneryMood } from "./scenery";
import { wobble } from "../motion";

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
  /** What the music asks of the scenery: lamps swelling and flickering, flames leaping. */
  mood?: SceneryMood;
};

/** Ground-standing set dressing. `unit` is one figure-height in pixels; `gy` is the ground line. */
export const PropShape = ({ kind, x, gy, unit, c, t, pulse, sway, mood = CALM }: Props) => {
  const lit = c.time === "night" || c.time === "dusk";
  switch (kind) {
    case "lamp": {
      const hgt = unit * 0.86;
      return (
        <g transform={`translate(${x} ${gy})`}>
          {lit && <polygon points={`${-unit * 0.04},${-hgt} ${unit * 0.04},${-hgt} ${unit * 0.3},0 ${-unit * 0.3},0`} fill={c.light} opacity={(0.1 + 0.015 * Math.sin(t * 3) + 0.05 * pulse) * (1 + 0.5 * mood.glow)} />}
          {lit && <circle cx={0} cy={-hgt} r={unit * (0.2 + 0.03 * pulse + 0.04 * mood.energy)} fill={c.light} opacity={Math.max(0, 0.22 + 0.1 * pulse + 0.06 * mood.glow + 0.05 * mood.flicker * wobble(0, t, 70, 5))} />}
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
    case "campfire": {
      // The flames leap with the music: taller and quicker the louder it is.
      const flick = (k: number) => 1 + 0.12 * Math.sin(t * (9 + k * 3) + k * 2) + 0.18 * pulse + 0.45 * mood.energy;
      return (
        <g transform={`translate(${x} ${gy})`}>
          {lit && <circle cx={0} cy={-unit * 0.08} r={unit * (0.34 + 0.04 * pulse + 0.1 * mood.energy)} fill={c.light} opacity={0.2 + 0.08 * pulse + 0.12 * mood.energy} />}
          <rect x={-unit * 0.09} y={-unit * 0.025} width={unit * 0.18} height={unit * 0.03} rx={unit * 0.012} fill={c.ink} transform={`rotate(-8 0 -${unit * 0.01})`} />
          <rect x={-unit * 0.09} y={-unit * 0.025} width={unit * 0.18} height={unit * 0.03} rx={unit * 0.012} fill={c.ink} transform={`rotate(8 0 -${unit * 0.01})`} />
          {[[-0.035, 0.1, 0], [0.03, 0.13, 1], [0, 0.17, 2]].map(([dx, h, k], i) => (
            <path key={i} d={`M ${(dx - 0.04) * unit} ${-unit * 0.03} Q ${(dx - 0.035) * unit} ${-unit * h * 0.7 * flick(k)} ${dx * unit} ${-unit * h * flick(k)} Q ${(dx + 0.035) * unit} ${-unit * h * 0.7 * flick(k)} ${(dx + 0.04) * unit} ${-unit * 0.03} Z`} fill={i === 2 ? mix(c.light, c.fg, 0.55) : c.light} opacity={0.95 - 0.15 * i} />
          ))}
        </g>
      );
    }
    case "fence":
      return (
        <g transform={`translate(${x} ${gy})`} fill={c.ink}>
          <rect x={-unit * 0.3} y={-unit * 0.2} width={unit * 0.6} height={unit * 0.016} />
          <rect x={-unit * 0.3} y={-unit * 0.1} width={unit * 0.6} height={unit * 0.016} />
          {[-0.28, -0.14, 0, 0.14, 0.28].map((dx) => (
            <polygon key={dx} points={`${(dx - 0.014) * unit},0 ${(dx - 0.014) * unit},${-unit * 0.24} ${dx * unit},${-unit * 0.265} ${(dx + 0.014) * unit},${-unit * 0.24} ${(dx + 0.014) * unit},0`} />
          ))}
        </g>
      );
    case "signpost":
      return (
        <g transform={`translate(${x} ${gy})`} fill={c.ink}>
          <rect x={-unit * 0.012} y={-unit * 0.5} width={unit * 0.024} height={unit * 0.5} />
          <polygon points={`${-unit * 0.1},${-unit * 0.46} ${unit * 0.09},${-unit * 0.46} ${unit * 0.13},${-unit * 0.425} ${unit * 0.09},${-unit * 0.39} ${-unit * 0.1},${-unit * 0.39}`} fill={mix(c.near, c.light, 0.25)} stroke={c.ink} strokeWidth={unit * 0.006} />
          <polygon points={`${unit * 0.1},${-unit * 0.37} ${-unit * 0.08},${-unit * 0.37} ${-unit * 0.12},${-unit * 0.335} ${-unit * 0.08},${-unit * 0.3} ${unit * 0.1},${-unit * 0.3}`} fill={mix(c.near, c.light, 0.25)} stroke={c.ink} strokeWidth={unit * 0.006} />
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
