import type { Action, Expression } from "../../../shared/types";
import { hexToHsl, hslToHex } from "../color";

export type Mood = NonNullable<Expression>;

const BY_ACTION: Record<Action, Mood> = {
  idle: "neutral",
  walk: "neutral",
  run: "determined",
  sit: "calm",
  wave: "happy",
  look_up: "surprised",
  reach: "sad",
  dance: "happy",
  jump: "happy",
  slump: "sad",
};

export const defaultExpression = (action: Action): Mood => BY_ACTION[action];

/** A dark shade of the skin color, so features read on any skin tone without a hard black. */
export function featureColor(skin: string): string {
  const { h, s, l } = hexToHsl(skin);
  return hslToHex({ h, s: s * 0.6, l: Math.min(18, l * 0.3) });
}

const BLINK_PERIOD = 3.7;
const BLINK_LENGTH = 0.13;

/** 1 = eyes open, near 0 = mid-blink. */
export const eyeOpen = (t: number) => (((t % BLINK_PERIOD) + BLINK_PERIOD) % BLINK_PERIOD < BLINK_LENGTH ? 0.15 : 1);

type Props = {
  mood: Mood;
  /** Center of the face area and the head radius, in the caller's coordinates; the figure faces +x. */
  cx: number;
  cy: number;
  r: number;
  color: string;
  t: number;
};

/** A three-quarter face: two dot eyes shifted toward the facing side, and a mouth. */
export const Face = ({ mood, cx, cy, r, color, t }: Props) => {
  const eyes = [cx - 0.22 * r, cx + 0.22 * r];
  const ey = cy - 0.05 * r;
  const my = cy + 0.38 * r;
  const w = 0.085 * r;
  const line = { stroke: color, strokeWidth: w, strokeLinecap: "round" as const, fill: "none" };
  const open = eyeOpen(t);

  const dots = (size: number) => eyes.map((x, i) => <ellipse key={i} cx={x} cy={ey} rx={size * r} ry={size * r * open} fill={color} />);
  const arcs = (up: boolean) =>
    eyes.map((x, i) => <path key={i} d={`M ${x - 0.1 * r} ${ey} Q ${x} ${ey + (up ? -0.13 : 0.13) * r} ${x + 0.1 * r} ${ey}`} {...line} />);
  // Brows slope toward the gap between the eyes: up there for sadness, down for resolve.
  const brows = (innerUp: boolean) =>
    eyes.map((x, i) => {
      const inner = i === 0 ? 1 : -1;
      const yIn = ey - (innerUp ? 0.25 : 0.12) * r;
      const yOut = ey - (innerUp ? 0.14 : 0.24) * r;
      return <line key={i} x1={x + inner * 0.1 * r} y1={yIn} x2={x - inner * 0.1 * r} y2={yOut} {...line} />;
    });
  const mouth = (curve: number, half = 0.13) => <path d={`M ${cx - half * r} ${my} Q ${cx} ${my + curve * r} ${cx + half * r} ${my}`} {...line} />;

  switch (mood) {
    case "happy":
      return <g>{arcs(true)}{mouth(0.2, 0.17)}</g>;
    case "sad":
      return <g>{dots(0.075)}{brows(true)}{mouth(-0.12)}</g>;
    case "surprised":
      return <g>{dots(0.1)}<ellipse cx={cx} cy={my + 0.02 * r} rx={0.07 * r} ry={0.1 * r} fill={color} /></g>;
    case "calm":
      return <g>{arcs(false)}{mouth(0.08, 0.1)}</g>;
    case "determined":
      return <g>{dots(0.075)}{brows(false)}{mouth(0, 0.12)}</g>;
    default:
      return <g>{dots(0.08)}{mouth(0.03, 0.1)}</g>;
  }
};
