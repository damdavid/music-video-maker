import { feature } from "../features";
import { accent, background, withAlpha } from "../color";
import type { PresetProps } from "./types";

export const GradientFlow = ({ uid, frame, t, width, height, analysis, palette, intensity, seed, params }: PresetProps) => {
  const low = feature(analysis, "low", frame);
  const high = feature(analysis, "high", frame);
  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      <rect width={width} height={height} fill={background(palette)} />
      {Array.from({ length: params.blobs }, (_, k) => {
        const phase = seed * 0.001 + k * 1.7;
        const drift = t * params.speed;
        const cx = width * (0.5 + 0.32 * Math.sin(drift * (0.13 + k * 0.05) + phase));
        const cy = height * (0.5 + 0.3 * Math.cos(drift * (0.11 + k * 0.04) + phase * 1.3));
        const r = Math.max(width, height) * (0.28 + 0.12 * k * 0.3 + 0.22 * low * intensity);
        const color = accent(palette, k);
        return (
          <g key={k}>
            <defs>
              <radialGradient id={`${uid}-gf-${k}`}>
                <stop offset="0%" stopColor={withAlpha(color, 0.35 + 0.4 * high * intensity)} />
                <stop offset="100%" stopColor={withAlpha(color, 0)} />
              </radialGradient>
            </defs>
            <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-gf-${k})`} />
          </g>
        );
      })}
    </svg>
  );
};
