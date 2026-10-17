import { useMemo } from "react";
import { feature } from "../features";
import { accent, background, withAlpha } from "../color";
import { mulberry32 } from "../rng";
import { beatPulse } from "../timing";
import type { PresetProps } from "./types";

const MAX_PARTICLES = 330;

type Particle = { x: number; y: number; speed: number; size: number; drift: number; color: number };

export const ParticleField = ({ t, frame, width, height, analysis, palette, intensity, seed, params }: PresetProps) => {
  const particles = useMemo<Particle[]>(() => {
    const rand = mulberry32(seed);
    return Array.from({ length: MAX_PARTICLES }, () => ({
      x: rand(),
      y: rand(),
      speed: 0.01 + rand() * 0.05,
      size: 1.5 + rand() * 5,
      drift: rand() * Math.PI * 2,
      color: Math.floor(rand() * 8),
    }));
  }, [seed]);

  const rms = feature(analysis, "rms", frame);
  const pulse = beatPulse(analysis.beats, t);
  const count = Math.min(MAX_PARTICLES, Math.round((70 + 150 * intensity) * params.density));
  const cx = width / 2;
  const cy = height / 2;

  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      <rect width={width} height={height} fill={background(palette)} />
      {particles.slice(0, count).map((p, i) => {
        // Upward drift wraps; a beat pushes particles outward from the center.
        const y = (((p.y - t * p.speed * (0.5 + intensity)) % 1) + 1) % 1;
        const baseX = p.x * width + Math.sin(t * 0.4 + p.drift) * 30;
        const baseY = y * height;
        const dx = baseX - cx;
        const dy = baseY - cy;
        const push = 1 + pulse * 0.08 * intensity;
        const r = p.size * params.size * (1 + pulse * 0.9 * intensity + rms * 0.6) * (Math.min(width, height) / 1080);
        return <circle key={i} cx={cx + dx * push} cy={cy + dy * push} r={r} fill={withAlpha(accent(palette, p.color), 0.25 + 0.6 * rms)} />;
      })}
    </svg>
  );
};
