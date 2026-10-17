import type { CharacterColors } from "../../../shared/types";
import { Face, featureColor, type Mood } from "./face";
import type { Hair, Outfit } from "./normalize";
import { layout, SEG, type Pose, type Pt } from "./rig";

type Props = {
  pose: Pose;
  colors: CharacterColors;
  hair: Hair;
  outfit: Outfit;
  /** Ground contact point and scale (pixels per figure-height). */
  x: number;
  y: number;
  size: number;
  facing: "left" | "right";
  /** Draws every part in one flat color (background silhouettes). */
  mono?: string;
  opacity?: number;
  /** Omitted for faceless figures (background silhouettes). */
  face?: { mood: Mood; t: number };
  /** Contact shadow colour; omitted for none. */
  shadow?: string;
};

const W = { arm: 0.05, leg: 0.068, torso: 0.155, neck: 0.045 };

type LineProps = { a: { x: number; y: number }; b: { x: number; y: number }; color: string; width: number };
const Seg = ({ a, b, color, width }: LineProps) => <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeLinecap="round" />;

/** A flat figure; emotion comes mostly from pose, with a simple face on top. */
export const Figure = ({ pose, colors, hair, outfit, x, y, size, facing, mono, opacity = 1, face, shadow }: Props) => {
  const j = layout(pose);
  const c = mono ? { body: mono, hair: mono, top: mono, bottom: mono, accent: mono } : colors;
  const r = SEG.headR;
  const dress = outfit === "dress";
  const legColor = dress && !mono ? c.body : c.bottom;
  const flip = facing === "left" ? -1 : 1;

  const arm = (shoulder: Pt, elbow: Pt, hand: Pt) => (
    <g>
      <Seg a={shoulder} b={elbow} color={c.top} width={W.arm} />
      <Seg a={elbow} b={hand} color={outfit === "coat" || outfit === "hoodie" ? c.top : c.body} width={W.arm * 0.9} />
      <circle cx={hand.x} cy={hand.y} r={0.028} fill={c.body} />
    </g>
  );
  const leg = (hip: Pt, knee: Pt, ankle: Pt) => (
    <g>
      <Seg a={hip} b={knee} color={legColor} width={W.leg} />
      <Seg a={knee} b={ankle} color={legColor} width={W.leg * 0.92} />
      <ellipse cx={ankle.x + 0.03} cy={ankle.y + 0.006} rx={0.056} ry={0.026} fill={c.accent} />
    </g>
  );

  const hairBack =
    hair === "long" ? <path transform={`rotate(${(pose.hair ?? 0).toFixed(2)} ${-0.2 * r} ${-0.6 * r})`} d={`M ${-1.15 * r} ${-0.9 * r} Q ${-1.5 * r} ${2.2 * r} ${-0.7 * r} ${4.3 * r} L ${0.4 * r} ${4.0 * r} L ${0.2 * r} ${-0.6 * r} Z`} fill={c.hair} /> : null;
  const hairCap = (
    <path d={`M ${-1.06 * r} ${0.05 * r} A ${1.06 * r} ${1.08 * r} 0 0 1 ${1.06 * r} ${0.05 * r} Q ${0.2 * r} ${-0.5 * r} ${-1.06 * r} ${0.05 * r} Z`} fill={c.hair} />
  );

  const stretch = pose.stretch ?? 1;
  return (
    <g transform={`translate(${x} ${y}) scale(${flip * size} ${size})`} opacity={opacity}>
      {shadow && <ContactShadow x={j.hip.x} lift={-pose.y} color={shadow} />}
      <g transform={stretch === 1 ? undefined : `scale(${(1 / Math.sqrt(stretch)).toFixed(4)} ${stretch.toFixed(4)})`}>
        {/* far side */}
        {arm(j.shoulder, j.elbowL, j.handL)}
        {leg(j.hip, j.kneeL, j.ankleL)}

        {/* torso and outfit */}
        <Seg a={j.hip} b={j.shoulder} color={c.top} width={W.torso} />
        {outfit === "coat" && <path d={`M ${j.hip.x - 0.085} ${j.hip.y - 0.02} L ${j.hip.x - 0.125} ${j.hip.y + 0.21} L ${j.hip.x + 0.125} ${j.hip.y + 0.21} L ${j.hip.x + 0.085} ${j.hip.y - 0.02} Z`} fill={c.top} />}
        {dress && <path d={`M ${j.hip.x - 0.075} ${j.hip.y - 0.05} L ${j.hip.x - 0.16} ${j.hip.y + 0.18} L ${j.hip.x + 0.16} ${j.hip.y + 0.18} L ${j.hip.x + 0.075} ${j.hip.y - 0.05} Z`} fill={c.top} />}
        <Seg a={j.shoulder} b={{ x: j.head.x, y: j.head.y }} color={c.body} width={W.neck} />

        {/* near leg, head, near arm */}
        {leg(j.hip, j.kneeR, j.ankleR)}
        <g transform={`translate(${j.head.x} ${j.head.y}) rotate(${j.headAngle})`}>
          {hairBack}
          {hair === "hood" && <circle cx={-0.1 * r} cy={0} r={1.28 * r} fill={c.top} />}
          {hair === "hood" ? <circle cx={0.3 * r} cy={0.08 * r} r={0.86 * r} fill={c.body} /> : <circle cx={0} cy={0} r={r} fill={c.body} />}
          {(hair === "short" || hair === "long" || hair === "bun") && hairCap}
          {hair === "bun" && <circle cx={-0.75 * r} cy={-1.1 * r} r={0.5 * r} fill={c.hair} />}
          {face && !mono && <Face mood={face.mood} cx={hair === "hood" ? 0.42 * r : 0.4 * r} cy={hair === "hood" ? 0.12 * r : 0.05 * r} r={hair === "hood" ? 0.9 * r : r} color={featureColor(colors.body)} t={face.t} />}
          {hair === "hat" && (
            <g fill={c.accent}>
              <ellipse cx={0} cy={-0.55 * r} rx={1.75 * r} ry={0.26 * r} />
              <rect x={-0.95 * r} y={-1.55 * r} width={1.9 * r} height={1.05 * r} rx={0.3 * r} />
            </g>
          )}
        </g>
        {arm(j.shoulder, j.elbowR, j.handR)}
      </g>
    </g>
  );
};

/** A soft oval under the figure that shrinks and fades as it leaves the ground, so figures sit in the scene. */
export const ContactShadow = ({ x, lift, color }: { x: number; lift: number; color: string }) => {
  const k = Math.max(0.35, 1 - lift * 2.6);
  return <ellipse cx={x} cy={0.012} rx={0.15 * k} ry={0.026 * k} fill={color} opacity={0.3 * k} />;
};
