import type { Action, Expression } from "../../../shared/types";
import { hexToHsl, hslToHex, mix } from "../color";

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
  point: "determined",
  lean: "calm",
  cross_arms: "sad",
  cheer: "happy",
};

export const defaultExpression = (action: Action): Mood => BY_ACTION[action];

/** A dark shade of the skin color, so features read on any skin tone without a hard black. */
export function featureColor(skin: string): string {
  const { h, s, l } = hexToHsl(skin);
  return hslToHex({ h, s: s * 0.6, l: Math.min(18, l * 0.3) });
}

const BLINK_PERIOD = 3.7;
const BLINK_LENGTH = 0.13;

/** Blink k happens near k * BLINK_PERIOD, nudged by up to 1.4 s so a blink never lands on a regular tick. */
const blinkAt = (k: number) => (k === 0 ? 0 : k * BLINK_PERIOD + 1.4 * frac(Math.sin(k * 12.9898) * 43758.5453));
const frac = (x: number) => x - Math.floor(x);

/** 1 = eyes open, near 0 = mid-blink; the lids close and reopen smoothly. */
export const eyeOpen = (t: number) => {
  const k = Math.round(t / BLINK_PERIOD);
  for (const n of [k - 1, k, k + 1]) {
    const p = (t - blinkAt(n)) / BLINK_LENGTH;
    if (n >= 0 && p >= 0 && p < 1) return 1 - 0.85 * Math.sin(Math.PI * p);
  }
  return 1;
};

type Props = {
  mood: Mood;
  /** Center of the face area and the head radius, in the caller's coordinates; the figure faces +x. */
  cx: number;
  cy: number;
  r: number;
  color: string;
  t: number;
  /** Skin color, for the cheeks; none are drawn without it. */
  skin?: string;
  /** Mouth opening 0..1 while singing; overrides the mood's mouth. */
  open?: number;
  /** Seen from the front (looking at the camera): the eyes sit evenly either side of the middle. */
  frontal?: boolean;
  /** How strongly the expression shows (1 is the drawn default): the music turns it up or down. */
  strength?: number;
  /** Where the eyes look (see gaze.ts); the pupils shift a little that way. */
  look?: { x: number; y: number };
};

/** A three-quarter face: eyes shifted toward the facing side, brows, cheeks and a mouth. */
export const Face = ({ mood, cx, cy, r, color, t, skin, open: sing = 0, frontal = false, strength = 1, look }: Props) => {
  const spread = frontal ? 0.3 : 0.22;
  const eyes = [cx - spread * r, cx + spread * r];
  const ey = cy - 0.05 * r;
  const my = cy + 0.38 * r;
  const w = 0.085 * r;
  const line = { stroke: color, strokeWidth: w, strokeLinecap: "round" as const, fill: "none" };
  const lid = eyeOpen(t);

  // The far eye is foreshortened.
  const dots = (size: number) =>
    eyes.map((x, i) => (
      <g key={i} transform={look ? `translate(${(look.x * 0.045 * r).toFixed(4)} ${(look.y * 0.04 * r).toFixed(4)})` : undefined}>
        <ellipse cx={x} cy={ey} rx={size * r * (i === 0 && !frontal ? 0.85 : 1)} ry={size * r * 1.35 * lid} fill={color} />
        {lid > 0.5 && <circle cx={x + 0.025 * r} cy={ey - 0.035 * r} r={0.028 * r} fill="#ffffff" opacity={0.85} />}
      </g>
    ));
  const arcs = (up: boolean) =>
    eyes.map((x, i) => <path key={i} d={`M ${x - 0.1 * r} ${ey} Q ${x} ${ey + (up ? -0.13 : 0.13) * r} ${x + 0.1 * r} ${ey}`} {...line} />);
  // Brows slope toward the gap between the eyes: up there for sadness, down for resolve.
  const brows = (innerUp: boolean | null) =>
    eyes.map((x, i) => {
      const inner = i === 0 ? 1 : -1;
      if (innerUp === null) return <path key={i} d={`M ${x - 0.11 * r} ${ey - 0.22 * r} Q ${x} ${ey - 0.29 * r} ${x + 0.11 * r} ${ey - 0.21 * r}`} {...line} strokeWidth={w * 0.8} />;
      const yIn = ey - (innerUp ? 0.14 + 0.11 * strength : 0.24 - 0.12 * strength) * r;
      const yOut = ey - (innerUp ? 0.25 - 0.11 * strength : 0.12 + 0.12 * strength) * r;
      return <line key={i} x1={x + inner * 0.1 * r} y1={yIn} x2={x - inner * 0.1 * r} y2={yOut} {...line} strokeWidth={w * 1.15} />;
    });
  const cheeks = (amount: number) =>
    skin &&
    [eyes[0] - 0.02 * r, eyes[1] + 0.04 * r].map((x, i) => <ellipse key={i} cx={x} cy={my - 0.1 * r} rx={0.11 * r} ry={0.065 * r} fill={mix(skin, "#e0556a", 0.55)} opacity={Math.min(1, amount * strength)} />);
  const mouth = (curve: number, half = 0.13) => <path d={`M ${cx - half * r} ${my} Q ${cx} ${my + curve * strength * r} ${cx + half * r} ${my}`} {...line} />;
  // An open mouth: a dark D-shape with a tongue, for grins and for singing.
  const gape = (half: number, depth: number) => (
    <g>
      <path d={`M ${cx - half * r} ${my - 0.02 * r} Q ${cx} ${my + 0.03 * r} ${cx + half * r} ${my - 0.02 * r} Q ${cx + half * 0.7 * r} ${my + depth * r} ${cx} ${my + depth * r} Q ${cx - half * 0.7 * r} ${my + depth * r} ${cx - half * r} ${my - 0.02 * r} Z`} fill={color} />
      {depth > 0.12 && <ellipse cx={cx} cy={my + (depth - 0.035) * r} rx={half * 0.45 * r} ry={0.03 * r} fill="#d4686f" />}
    </g>
  );
  const singing = sing > 0.08 ? gape(0.1 + 0.05 * sing, 0.04 + 0.17 * sing) : null;

  switch (mood) {
    case "happy":
      return <g>{cheeks(0.5)}{arcs(true)}{brows(null)}{singing ?? gape(0.15, 0.11)}</g>;
    case "sad":
      return <g>{dots(0.07)}{brows(true)}{singing ?? mouth(-0.12)}</g>;
    case "surprised":
      return <g>{cheeks(0.3)}{dots(0.1)}{brows(null)}{singing ?? <ellipse cx={cx} cy={my + 0.02 * r} rx={0.07 * r} ry={0.1 * r} fill={color} />}</g>;
    case "calm":
      return <g>{cheeks(0.35)}{arcs(false)}{singing ?? mouth(0.08, 0.1)}</g>;
    case "determined":
      return <g>{dots(0.07)}{brows(false)}{singing ?? mouth(0, 0.12)}</g>;
    default:
      return <g>{cheeks(0.2)}{dots(0.075)}{brows(null)}{singing ?? mouth(0.03, 0.1)}</g>;
  }
};
