import { accent, background, brightestAccent, foreground, withAlpha } from "../color";
import { mulberry32 } from "../rng";
import { printScale } from "../riso/print";
import { beatPulse } from "../timing";
import { activeRipples, lensRadius, rippleRadius, wobblyRing } from "./rippleMath";
import type { PresetProps } from "./types";

/** A dot at the centre sends a hand-drawn ring out on every beat; a pale double ring around it tightens on each downbeat. */
export const Ripples = ({ t, width, height, analysis, palette, intensity, seed, params }: PresetProps) => {
  const unit = Math.min(width, height);
  const k = printScale(unit);
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.hypot(width, height) / 2;
  const pulse = beatPulse(analysis.beats, t);
  const rings = activeRipples(analysis.beats, t, params.every, params.life);
  const lens = lensRadius(analysis.downbeats, t, unit);
  const dotR = unit * 0.011 * (1 + 0.3 * pulse * intensity);

  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      <rect width={width} height={height} fill={background(palette)} />
      {rings.map((rp) => {
        const r = rippleRadius(rp.life, maxR);
        const color = accent(palette, rp.index);
        const fade = Math.pow(1 - rp.life, 0.6);
        // Tapers as it leaves, but stays a visible line.
        const w = unit * (0.004 + 0.006 * intensity) * Math.pow(1 - rp.life, 0.8) + 0.6 * k;
        const rand = mulberry32((seed ^ Math.imul(rp.index + 3, 0x9e3779b1)) >>> 0);
        const tickAngles = [rand() * 6.28, rand() * 6.28];
        return (
          <g key={rp.index} opacity={fade}>
            <path d={wobblyRing(cx, cy, r, seed, rp.index)} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" />
            {rp.life < 0.55 &&
              tickAngles.flatMap((a, ai) =>
                [0, 1, 2].map((j) => {
                  const rr = r * 1.04 + j * unit * 0.008;
                  const span = 0.09 - j * 0.015;
                  const x1 = cx + Math.cos(a - span) * rr;
                  const y1 = cy + Math.sin(a - span) * rr;
                  const x2 = cx + Math.cos(a + span) * rr;
                  const y2 = cy + Math.sin(a + span) * rr;
                  return <path key={`${ai}-${j}`} d={`M${x1.toFixed(1)} ${y1.toFixed(1)} A${rr.toFixed(1)} ${rr.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`} fill="none" stroke={color} strokeWidth={w * 0.6} strokeLinecap="round" />;
                }),
              )}
          </g>
        );
      })}
      {params.lens >= 0.5 &&
        [0, 1].map((j) => (
          <circle key={j} cx={cx} cy={cy} r={lens + j * unit * 0.009} fill="none" stroke={withAlpha(foreground(palette), j === 0 ? 0.6 : 0.3)} strokeWidth={unit * 0.0028} />
        ))}
      {/* A second ink a hair off register gives the dot its fringe. */}
      <circle cx={cx + 1.6 * k} cy={cy + 0.8 * k} r={dotR} fill={accent(palette, 1)} opacity={0.85} />
      <circle cx={cx} cy={cy} r={dotR} fill={brightestAccent(palette)} />
    </svg>
  );
};
