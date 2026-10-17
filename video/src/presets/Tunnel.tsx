import { feature } from "../features";
import { accent, background, withAlpha } from "../color";
import { beatPulse } from "../timing";
import type { PresetProps } from "./types";

export const Tunnel = ({ t, frame, width, height, analysis, palette, intensity, params }: PresetProps) => {
  const LAYERS = params.layers;
  const rms = feature(analysis, "rms", frame);
  const pulse = beatPulse(analysis.beats, t);
  const reach = Math.hypot(width, height) / 2;
  // Constant speed (not rms-driven) so scrubbing/seeking stays a pure function of t.
  const travel = t * (0.35 + 0.5 * intensity) * params.speed;

  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      <rect width={width} height={height} fill={background(palette)} />
      <g transform={`translate(${width / 2} ${height / 2})`}>
        {Array.from({ length: LAYERS }, (_, i) => {
          const phase = (((i + travel) % LAYERS) + LAYERS) % LAYERS;
          const depth = phase / LAYERS; // 0 far .. 1 near
          const size = reach * 2 * Math.pow(depth, 2.2) * (1 + pulse * 0.05 * intensity);
          return (
            <rect
              key={i}
              x={-size / 2}
              y={-size / 2}
              width={size}
              height={size}
              rx={size * 0.12}
              transform={`rotate(${depth * 40 * (0.5 + intensity) + t * 5})`}
              fill="none"
              stroke={withAlpha(accent(palette, i), Math.min(1, depth * 1.4) * (0.35 + 0.6 * rms))}
              strokeWidth={2 + depth * 10}
            />
          );
        })}
      </g>
    </svg>
  );
};
