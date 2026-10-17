import { chromaAt, feature } from "../features";
import { accent, background, withAlpha } from "../color";
import { beatPulse } from "../timing";
import type { PresetProps } from "./types";

export const SpectrumRings = ({ t, frame, width, height, analysis, palette, intensity, params }: PresetProps) => {
  const unit = Math.min(width, height);
  const pulse = beatPulse(analysis.beats, t);
  const bands = [feature(analysis, "low", frame), feature(analysis, "mid", frame), feature(analysis, "high", frame)];
  const chroma = chromaAt(analysis, frame);
  const RINGS = params.rings;
  const BARS = params.bars;
  const cx = width / 2;
  const cy = height / 2;

  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      <rect width={width} height={height} fill={background(palette)} />
      {Array.from({ length: RINGS }, (_, i) => {
        const band = bands[Math.min(Math.floor((i / RINGS) * 3), 2)];
        const r = unit * (0.1 + i * 0.065) * (1 + pulse * 0.05 * intensity * (RINGS - i) * 0.3);
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={withAlpha(accent(palette, i), 0.3 + 0.6 * band)} strokeWidth={unit * (0.004 + 0.014 * band * intensity)} />
        );
      })}
      {Array.from({ length: BARS }, (_, k) => {
        const angle = (k / BARS) * Math.PI * 2 - Math.PI / 2 + t * 0.15;
        const inner = unit * 0.5 * 0.82;
        const len = unit * (0.02 + 0.16 * chroma[k % 12] * (0.4 + intensity));
        return (
          <line
            key={k}
            x1={cx + Math.cos(angle) * inner}
            y1={cy + Math.sin(angle) * inner}
            x2={cx + Math.cos(angle) * (inner + len)}
            y2={cy + Math.sin(angle) * (inner + len)}
            stroke={withAlpha(accent(palette, k), 0.85)}
            strokeWidth={unit * 0.012}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
};
