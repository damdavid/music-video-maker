import { feature } from "../features";
import { accent, background, withAlpha } from "../color";
import { beatPulse } from "../timing";
import type { PresetProps } from "./types";

export const GeometricGrid = ({ t, frame, width, height, analysis, palette, intensity, params }: PresetProps) => {
  const cols = params.cells;
  const cell = width / cols;
  const rows = Math.ceil(height / cell);
  const downbeat = beatPulse(analysis.downbeats, t, 0.4);
  const mid = feature(analysis, "mid", frame);
  const cx = cols / 2;
  const cy = rows / 2;

  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      <rect width={width} height={height} fill={background(palette)} />
      {Array.from({ length: cols * rows }, (_, n) => {
        const c = n % cols;
        const r = Math.floor(n / cols);
        const dist = Math.hypot(c - cx, r - cy);
        // A wave travels outward from the center; each downbeat kicks it.
        const wave = 0.5 + 0.5 * Math.sin(dist * 0.9 - t * 2.2);
        const s = cell * (0.18 + 0.5 * wave * (0.4 + intensity * 0.6) + 0.25 * downbeat * intensity);
        const x = (c + 0.5) * cell;
        const y = (r + 0.5) * cell;
        return (
          <rect
            key={n}
            x={-s / 2}
            y={-s / 2}
            width={s}
            height={s}
            transform={`translate(${x} ${y}) rotate(${45 * wave + t * 6 * params.spin})`}
            fill={withAlpha(accent(palette, c + r), 0.2 + 0.6 * wave * (0.4 + mid))}
          />
        );
      })}
    </svg>
  );
};
