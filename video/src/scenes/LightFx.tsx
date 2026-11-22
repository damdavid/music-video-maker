import { SHOWS } from "./lighting";
import type { TimeOfDay } from "../../../shared/types";

/** A brief lift of the whole frame's light on a beat. */
export const LightPulse = ({ w, h, color, amount }: { w: number; h: number; color: string; amount: number }) =>
  amount > 0.002 ? <rect width={w} height={h} fill={color} opacity={amount} style={{ mixBlendMode: "screen" }} /> : null;

type FlareProps = { uid: string; w: number; h: number; x: number; y: number; amount: number; color: string; t: number; time: TimeOfDay };

/** A lens flare at the sun or moon: a glow, a few rays, and ghosts strung along the line through the middle of the frame. */
export const LensFlare = ({ uid, w, h, x, y, amount, color, t, time }: FlareProps) => {
  if (amount < 0.03) return null;
  const u = Math.min(w, h);
  const spin = t * 4;
  const cx = w / 2;
  const cy = h / 2;
  const ghosts = [0.32, 0.55, 0.88].map((k, i) => ({ x: x + (cx - x) * k * 2, y: y + (cy - y) * k * 2, r: u * (0.05 + 0.025 * i), o: 0.35 - 0.08 * i }));
  return (
    <g style={{ mixBlendMode: "screen" }} opacity={Math.min(1, amount) * (0.55 + 0.45 * SHOWS[time])}>
      <defs>
        <radialGradient id={`${uid}-flare`}>
          <stop offset="0" stopColor={color} stopOpacity={0.95} />
          <stop offset="0.35" stopColor={color} stopOpacity={0.3} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={x} cy={y} r={u * 0.38} fill={`url(#${uid}-flare)`} />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i * Math.PI) / 3 + spin * 0.02;
        return <line key={i} x1={x} y1={y} x2={x + Math.cos(a) * u * 0.46} y2={y + Math.sin(a) * u * 0.46} stroke={color} strokeWidth={u * 0.004} strokeLinecap="round" opacity={0.45} />;
      })}
      {ghosts.map((g, i) => (
        <circle key={i} cx={g.x} cy={g.y} r={g.r} fill="none" stroke={color} strokeWidth={u * 0.006} opacity={g.o} />
      ))}
    </g>
  );
};

/** The filter that edges a figure with light from behind: a soft crescent on its back side, brighter as the music is. */
export const RimLightFilter = ({ id, color, strength }: { id: string; color: string; strength: number }) => (
  <filter id={id} x="-35%" y="-15%" width="170%" height="130%" colorInterpolationFilters="sRGB">
    <feMorphology in="SourceAlpha" operator="dilate" radius={0.009} result="fat" />
    <feOffset in="fat" dx={-0.011} dy={0} result="behind" />
    <feComposite in="behind" in2="SourceAlpha" operator="out" result="edge" />
    <feGaussianBlur in="edge" stdDeviation={0.0028} result="soft" />
    <feFlood floodColor={color} floodOpacity={strength} result="tint" />
    <feComposite in="tint" in2="soft" operator="in" result="rim" />
    <feMerge>
      <feMergeNode in="SourceGraphic" />
      <feMergeNode in="rim" />
    </feMerge>
  </filter>
);
