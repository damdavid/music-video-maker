import type { CharacterColors } from "../../../shared/types";
import { hexToHsl, hslToHex } from "../color";
import { Face, featureColor, type Mood } from "./face";
import type { Gender, Hair, Outfit } from "./normalize";
import { layout, SEG, type Pose, type Pt } from "./rig";

type Props = {
  pose: Pose;
  colors: CharacterColors;
  hair: Hair;
  outfit: Outfit;
  /** Shapes the torso: broader shoulders and narrower hips for male, the reverse for female. Omitted for silhouettes. */
  gender?: Gender;
  /** Ground contact point and scale (pixels per figure-height). */
  x: number;
  y: number;
  size: number;
  facing: "left" | "right";
  /** Draws every part in one flat color (background silhouettes). */
  mono?: string;
  opacity?: number;
  /** Omitted for faceless figures (background silhouettes). `open` is the mouth opening 0..1 while singing. */
  face?: { mood: Mood; t: number; open?: number };
  /** Contact shadow colour; omitted for none. */
  shadow?: string;
};

/** Visible outline thickness, in figure-heights. */
const OW = 0.0065;
// Limb radii at each end, in figure-heights.
const R = { shoulder: 0.03, elbow: 0.025, wrist: 0.02, thigh: 0.042, knee: 0.032, ankle: 0.023, neck: 0.021 };

const shade = (hex: string, dl: number) => {
  const { h, s, l } = hexToHsl(hex);
  // Relative, so dark colors stay readable instead of going black.
  return hslToHex({ h, s, l: Math.max(0, Math.min(100, dl < 0 ? l * (1 + dl / 70) : l + dl)) });
};

const lerp = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const f = (n: number) => n.toFixed(4);
const P = (c: Pt, r: number, a: number) => `${f(c.x + r * Math.cos(a))} ${f(c.y + r * Math.sin(a))}`;

/** A capsule that tapers from radius ra at a to rb at b (the outer tangents joined by an arc around each end). */
function tube(a: Pt, ra: number, b: Pt, rb: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  const ang = Math.atan2(dy, dx);
  const al = Math.acos(Math.max(-1, Math.min(1, (ra - rb) / len)));
  const farBig = al > Math.PI / 2 ? 1 : 0;
  return `M ${P(a, ra, ang + al)} L ${P(b, rb, ang + al)} A ${rb} ${rb} 0 ${farBig} 0 ${P(b, rb, ang - al)} L ${P(a, ra, ang - al)} A ${ra} ${ra} 0 ${1 - farBig} 0 ${P(a, ra, ang + al)} Z`;
}

type Part = { a: Pt; ra: number; b: Pt; rb: number; fill: string };

/** The side of a segment facing away from the figure's front, where the shadow band goes. */
function backNormal(a: Pt, b: Pt): Pt {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  return n.x < -0.05 || (Math.abs(n.x) <= 0.05 && n.y > 0) ? n : { x: -n.x, y: -n.y };
}

/** Segments drawn as one limb: every outline first, so the joints between segments don't show a seam. */
const Limb = ({ parts, ink, flat }: { parts: Part[]; ink: string; flat: boolean }) => (
  <g>
    {!flat && parts.map((p, i) => <path key={`o${i}`} d={tube(p.a, p.ra, p.b, p.rb)} fill={ink} stroke={ink} strokeWidth={2 * OW} strokeLinejoin="round" />)}
    {parts.map((p, i) => <path key={`f${i}`} d={tube(p.a, p.ra, p.b, p.rb)} fill={p.fill} />)}
    {!flat &&
      parts.map((p, i) => {
        const n = backNormal(p.a, p.b);
        const off = (r: number) => 0.5 * r;
        const at = (pt: Pt, r: number): Pt => ({ x: pt.x + n.x * off(r), y: pt.y + n.y * off(r) });
        return <path key={`s${i}`} d={tube(at(p.a, p.ra), p.ra * 0.5, at(p.b, p.rb), p.rb * 0.5)} fill={shade(p.fill, -13)} />;
      })}
  </g>
);

/** A tapering torso from hip to shoulder, with a chest, a waist and hips, and the shadow strip down its back. */
/** How much wider or narrower each part of the torso is: hips, waist, shoulders. */
const BODY: Record<Gender, [number, number, number]> = { male: [0.94, 1.0, 1.12], female: [1.1, 0.88, 0.9] };

function torsoPath(hip: Pt, shoulder: Pt, front: number, back: number, shape: [number, number, number] = [1, 1, 1]): string {
  const len = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y) || 1e-6;
  const u = { x: (shoulder.x - hip.x) / len, y: (shoulder.y - hip.y) / len };
  // Perpendicular pointing the way the figure faces (+x when upright).
  const n = { x: -u.y, y: u.x };
  const at = (k: number, side: number): Pt => {
    const c = lerp(hip, shoulder, k);
    return { x: c.x + n.x * side, y: c.y + n.y * side };
  };
  const wf = (k: number) => front * [0.058, 0.046, 0.06][k] * shape[k];
  const wb = (k: number) => back * [0.062, 0.044, 0.052][k] * shape[k];
  const hipF = at(0, wf(0));
  const hipB = at(0, -wb(0));
  const midF = at(0.5, wf(1));
  const midB = at(0.5, -wb(1));
  const topF = at(0.96, wf(2));
  const topB = at(0.96, -wb(2));
  const crown = { x: shoulder.x + u.x * 0.022, y: shoulder.y + u.y * 0.022 };
  // Control points chosen so each side passes through its waist point.
  const ctl = (lo: Pt, mid: Pt, hi: Pt) => `${f(2 * mid.x - (lo.x + hi.x) / 2)} ${f(2 * mid.y - (lo.y + hi.y) / 2)}`;
  return `M ${f(hipF.x)} ${f(hipF.y)} Q ${ctl(hipF, midF, topF)} ${f(topF.x)} ${f(topF.y)} Q ${f(crown.x + n.x * 0.04)} ${f(crown.y + n.y * 0.04)} ${f(crown.x)} ${f(crown.y)} Q ${f(crown.x - n.x * 0.04)} ${f(crown.y - n.y * 0.04)} ${f(topB.x)} ${f(topB.y)} Q ${ctl(topB, midB, hipB)} ${f(hipB.x)} ${f(hipB.y)} Q ${f(hip.x - u.x * 0.03)} ${f(hip.y - u.y * 0.03)} ${f(hipF.x)} ${f(hipF.y)} Z`;
}

const Hand = ({ elbow, hand, fill, ink, flat }: { elbow: Pt; hand: Pt; fill: string; ink: string; flat: boolean }) => {
  const a = (Math.atan2(hand.y - elbow.y, hand.x - elbow.x) * 180) / Math.PI;
  // The thumb is on the figure's front side of the hand.
  const side = Math.abs(a) > 90 ? 1 : -1;
  return (
    <g transform={`translate(${f(hand.x)} ${f(hand.y)}) rotate(${f(a)})`} fill={fill} stroke={flat ? "none" : ink} strokeWidth={2 * OW} paintOrder="stroke" strokeLinejoin="round">
      <ellipse cx={0.012} cy={0} rx={0.03} ry={0.024} />
      <ellipse cx={0.004} cy={side * 0.021} rx={0.015} ry={0.009} transform={`rotate(${side * 28} 0.004 ${side * 0.021})`} />
    </g>
  );
};

const Shoe = ({ knee, ankle, lift, color, ink, flat }: { knee: Pt; ankle: Pt; lift: number; color: string; ink: string; flat: boolean }) => {
  // A planted foot lies flat; a lifted one points its toe down behind the body and up in front of it.
  const shin = (Math.atan2(ankle.x - knee.x, ankle.y - knee.y) * 180) / Math.PI;
  const pitch = -shin * 0.6 * Math.min(1, Math.max(0, lift) / 0.05);
  return (
    <g transform={`translate(${f(ankle.x)} ${f(ankle.y)}) rotate(${f(pitch)})`}>
      <path
        d="M -0.036 -0.016 Q -0.048 0.028 -0.03 0.034 L 0.07 0.034 Q 0.094 0.03 0.086 0.012 Q 0.07 -0.004 0.03 -0.012 L 0.012 -0.028 Z"
        fill={color}
        stroke={flat ? "none" : ink}
        strokeWidth={2 * OW}
        paintOrder="stroke"
        strokeLinejoin="round"
      />
      {!flat && <path d="M -0.044 0.024 L 0.09 0.024 Q 0.094 0.034 0.07 0.034 L -0.03 0.034 Q -0.046 0.034 -0.044 0.024 Z" fill={shade(color, -26)} />}
    </g>
  );
};

/** A flat figure, drawn with outlines and a band of shade on each form; emotion comes from pose and a simple face. */
export const Figure = ({ pose, colors, hair, outfit, gender, x, y, size, facing, mono, opacity = 1, face, shadow }: Props) => {
  const j = layout(pose);
  const c = mono ? { body: mono, hair: mono, top: mono, bottom: mono, accent: mono } : colors;
  const flat = !!mono;
  const ink = mono ?? featureColor(colors.body);
  const r = SEG.headR;
  const dress = outfit === "dress";
  const longSleeves = outfit === "coat" || outfit === "hoodie";
  const legColor = dress && !mono ? c.body : c.bottom;
  const flip = facing === "left" ? -1 : 1;
  const edge = { stroke: flat ? "none" : ink, strokeWidth: 2 * OW, paintOrder: "stroke", strokeLinejoin: "round" } as const;

  const arm = (elbow: Pt, hand: Pt) => {
    const skin = c.body;
    const sleeve = c.top;
    const cuff = shade(sleeve, -16);
    const parts: Part[] = [
      { a: j.shoulder, ra: R.shoulder, b: elbow, rb: R.elbow, fill: longSleeves ? sleeve : skin },
      { a: elbow, ra: R.elbow, b: hand, rb: R.wrist, fill: longSleeves ? sleeve : skin },
    ];
    const cap = lerp(j.shoulder, elbow, 0.55);
    return (
      <g>
        <Limb parts={parts} ink={ink} flat={flat} />
        {!longSleeves && <path d={tube(j.shoulder, R.shoulder + 0.006, cap, R.shoulder * 0.93 + 0.006)} fill={sleeve} {...edge} />}
        {longSleeves && !flat && <path d={tube(lerp(elbow, hand, 0.8), R.wrist + 0.004, hand, R.wrist + 0.003)} fill={cuff} {...edge} />}
        <Hand elbow={elbow} hand={hand} fill={skin} ink={ink} flat={flat} />
      </g>
    );
  };

  const leg = (knee: Pt, ankle: Pt) => (
    <g>
      <Limb
        parts={[
          { a: j.hip, ra: R.thigh, b: knee, rb: R.knee, fill: legColor },
          { a: knee, ra: R.knee, b: ankle, rb: R.ankle, fill: legColor },
        ]}
        ink={ink}
        flat={flat}
      />
      <Shoe knee={knee} ankle={ankle} lift={-(ankle.y - pose.y)} color={c.accent} ink={ink} flat={flat} />
    </g>
  );

  // A skirt or coat hem swings with the knees.
  const sway = ((j.kneeL.x + j.kneeR.x) / 2 - j.hip.x) * 0.35;
  const hem = (half: number, drop: number) => {
    const { x: hx, y: hy } = j.hip;
    const mid = hx + sway;
    return `M ${f(hx - 0.05)} ${f(hy - 0.03)} Q ${f(hx - 0.085)} ${f(hy + drop * 0.45)} ${f(mid - half)} ${f(hy + drop)} Q ${f(mid)} ${f(hy + drop + 0.018)} ${f(mid + half)} ${f(hy + drop)} Q ${f(hx + 0.085)} ${f(hy + drop * 0.45)} ${f(hx + 0.05)} ${f(hy - 0.03)} Z`;
  };

  const shape = gender ? BODY[gender] : undefined;
  const torso = torsoPath(j.hip, j.shoulder, 1, 1, shape);
  const torsoShade = torsoPath(j.hip, j.shoulder, -0.5, 1, shape);
  const top = outfit === "hoodie" ? shade(c.top, 0) : c.top;

  const hairBack =
    hair === "long" ? (
      <path transform={`rotate(${(pose.hair ?? 0).toFixed(2)} -0.2 -0.6)`} d="M -0.9 -0.7 C -1.9 0.5 -1.75 3.0 -1.0 4.25 Q -0.15 4.55 0.45 3.9 L 0.25 0.2 Z" fill={c.hair} {...edge} strokeWidth={(2 * OW) / r} />
    ) : null;
  const hairCap = (
    <g>
      <path d="M -1.0 0.62 C -1.28 -0.95 -0.4 -1.36 0.35 -1.26 C 0.95 -1.18 1.16 -0.6 1.04 -0.12 C 0.82 -0.58 0.3 -0.72 -0.1 -0.5 C -0.5 -0.34 -0.78 -0.02 -0.78 0.28 Z" fill={c.hair} {...edge} strokeWidth={(2 * OW) / r} />
      {!flat && <path d="M -0.7 -0.95 C -0.3 -1.2 0.3 -1.22 0.62 -1.05 C 0.2 -1.0 -0.3 -0.85 -0.7 -0.95 Z" fill={shade(c.hair, 12)} />}
    </g>
  );

  const stretch = pose.stretch ?? 1;
  const skinHead = (fill: string) => (
    <>
      <circle cx={0} cy={-0.02} r={1} fill={fill} />
      <ellipse cx={0.14} cy={0.3} rx={0.82} ry={0.76} fill={fill} />
    </>
  );

  return (
    <g transform={`translate(${x} ${y}) scale(${flip * size} ${size})`} opacity={opacity}>
      {shadow && <ContactShadow x={j.hip.x} lift={-pose.y} color={shadow} />}
      <g transform={stretch === 1 ? undefined : `scale(${(1 / Math.sqrt(stretch)).toFixed(4)} ${stretch.toFixed(4)})`}>
        {/* far side */}
        {arm(j.elbowL, j.handL)}
        {leg(j.kneeL, j.ankleL)}
        {leg(j.kneeR, j.ankleR)}

        {/* neck, torso and outfit */}
        <Limb parts={[{ a: j.shoulder, ra: R.neck, b: { x: j.head.x - Math.sin((j.headAngle * Math.PI) / 180) * r * 0.55, y: j.head.y + Math.cos((j.headAngle * Math.PI) / 180) * r * 0.55 }, rb: R.neck * 0.95, fill: c.body }]} ink={ink} flat={flat} />
        {dress && <path d={hem(0.165, 0.19)} fill={c.top} {...edge} />}
        {outfit === "coat" && <path d={hem(0.14, 0.23)} fill={c.top} {...edge} />}
        <path d={torso} fill={top} {...edge} />
        {!flat && <path d={torsoShade} fill={shade(top, -13)} />}
        {!flat && outfit === "hoodie" && (
          <g fill="none" stroke={shade(top, -18)} strokeWidth={0.006} strokeLinecap="round">
            <path d={`M ${f(j.hip.x - 0.045)} ${f(j.hip.y - 0.07)} Q ${f(j.hip.x)} ${f(j.hip.y - 0.045)} ${f(j.hip.x + 0.045)} ${f(j.hip.y - 0.07)}`} />
            <path d={`M ${f(j.shoulder.x + 0.012)} ${f(j.shoulder.y + 0.03)} l 0.004 0.06 M ${f(j.shoulder.x + 0.03)} ${f(j.shoulder.y + 0.03)} l 0 0.055`} />
          </g>
        )}
        {!flat && outfit === "coat" && <path d={`M ${f(j.shoulder.x + 0.012)} ${f(j.shoulder.y + 0.012)} L ${f(j.hip.x + 0.012)} ${f(j.hip.y + 0.2)}`} fill="none" stroke={shade(c.top, -18)} strokeWidth={0.006} strokeLinecap="round" />}
        {!flat && (outfit === "tee" || dress) && <path d={`M ${f(j.shoulder.x - 0.018)} ${f(j.shoulder.y + 0.004)} Q ${f(j.shoulder.x + 0.02)} ${f(j.shoulder.y + 0.04)} ${f(j.shoulder.x + 0.052)} ${f(j.shoulder.y + 0.004)}`} fill="none" stroke={shade(c.top, -16)} strokeWidth={0.006} strokeLinecap="round" />}

        {/* head */}
        <g transform={`translate(${j.head.x} ${j.head.y}) rotate(${j.headAngle}) scale(${r})`}>
          {hairBack}
          {hair === "hood" && (
            <g>
              <circle cx={-0.15} cy={-0.02} r={1.3} fill={c.top} stroke={flat ? "none" : ink} strokeWidth={(2 * OW) / r} />
              {!flat && <circle cx={0.1} cy={0.04} r={1.04} fill={shade(c.top, -20)} />}
            </g>
          )}
          {hair === "hood" ? (
            <g>
              {!flat && <g fill={ink} stroke={ink} strokeWidth={(2 * OW) / r}><circle cx={0.3} cy={0.08} r={0.86} /></g>}
              <circle cx={0.3} cy={0.08} r={0.86} fill={c.body} />
            </g>
          ) : (
            <g>
              {!flat && <g fill={ink} stroke={ink} strokeWidth={(2 * OW) / r} strokeLinejoin="round">{skinHead(ink)}<circle cx={0.98} cy={0.14} r={0.16} /></g>}
              {skinHead(c.body)}
              <circle cx={0.98} cy={0.14} r={0.15} fill={c.body} />
              {!flat && <ellipse cx={-0.5} cy={0.28} rx={0.12} ry={0.19} fill={shade(c.body, -10)} />}
            </g>
          )}
          {(hair === "short" || hair === "long" || hair === "bun") && hairCap}
          {hair === "bun" && <circle cx={-0.8} cy={-1.12} r={0.5} fill={c.hair} {...edge} strokeWidth={(2 * OW) / r} />}
          {face && !mono && (
            <Face
              mood={face.mood}
              cx={hair === "hood" ? 0.42 : 0.4}
              cy={hair === "hood" ? 0.12 : 0.05}
              r={hair === "hood" ? 0.9 : 1}
              color={featureColor(colors.body)}
              t={face.t}
              skin={colors.body}
              open={face.open}
            />
          )}
          {hair === "hat" && (
            <g fill={c.accent} {...edge} strokeWidth={(2 * OW) / r}>
              <rect x={-0.95} y={-1.62} width={1.9} height={1.1} rx={0.32} />
              <ellipse cx={0} cy={-0.55} rx={1.75} ry={0.26} />
              {!flat && <path d="M -0.94 -0.78 Q 0 -0.66 0.94 -0.78 L 0.94 -0.6 Q 0 -0.5 -0.94 -0.6 Z" fill={shade(c.accent, -22)} stroke="none" />}
            </g>
          )}
        </g>
        {arm(j.elbowR, j.handR)}
      </g>
    </g>
  );
};

/** A soft oval under the figure that shrinks and fades as it leaves the ground, so figures sit in the scene. */
export const ContactShadow = ({ x, lift, color }: { x: number; lift: number; color: string }) => {
  const k = Math.max(0.35, 1 - lift * 2.6);
  return <ellipse cx={x} cy={0.012} rx={0.15 * k} ry={0.026 * k} fill={color} opacity={0.3 * k} />;
};
