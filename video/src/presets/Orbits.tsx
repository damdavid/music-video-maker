import { accent, background, brightestAccent, foreground, withAlpha } from "../color";
import { mulberry32 } from "../rng";
import { printScale } from "../riso/print";
import { beatPulse } from "../timing";
import type { PresetProps } from "./types";

/** Rings of medallions circling the centre, each ring turning against the one inside it, like grooves on a record. */
export const Orbits = ({ t, width, height, analysis, palette, intensity, seed, params }: PresetProps) => {
  const unit = Math.min(width, height);
  const k = printScale(unit);
  const cx = width / 2;
  const cy = height / 2;
  const pulse = beatPulse(analysis.beats, t);
  const rand = mulberry32(seed ^ 0x6a09e667);

  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      <rect width={width} height={height} fill={background(palette)} />
      {Array.from({ length: params.orbits }, (_, o) => {
        const radius = unit * (0.14 + o * 0.115);
        const count = 6 + o * 4;
        const dir = o % 2 === 0 ? 1 : -1;
        const phase = rand() * Math.PI * 2;
        const angle0 = phase + dir * t * 0.22 * params.speed * (1 / (1 + o * 0.35));
        const size = unit * (0.05 - o * 0.004) * (1 + 0.18 * pulse * intensity * (1 / (1 + o)));
        return (
          <g key={o}>
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke={withAlpha(foreground(palette), 0.28)} strokeWidth={unit * 0.002} />
            {Array.from({ length: count }, (_, j) => {
              const a = angle0 + (j / count) * Math.PI * 2;
              const x = cx + Math.cos(a) * radius;
              const y = cy + Math.sin(a) * radius;
              const color = accent(palette, j + o);
              return (
                <g key={j}>
                  <circle cx={x + 2 * k} cy={y + 1.4 * k} r={size} fill={withAlpha(accent(palette, j + o + 1), 0.8)} />
                  <circle cx={x} cy={y} r={size} fill={color} />
                  <circle cx={x} cy={y} r={size * 0.62} fill="none" stroke={background(palette)} strokeWidth={size * 0.12} opacity={0.8} />
                  <circle cx={x} cy={y} r={size * 0.2} fill={brightestAccent(palette)} />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
};
