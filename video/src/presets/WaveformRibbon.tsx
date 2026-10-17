import { at } from "../features";
import { accent, background, withAlpha } from "../color";
import type { PresetProps } from "./types";

const STEPS = 90;

/** Scrolling loudness history: the right edge is "now", older audio trails to the left. */
export const WaveformRibbon = ({ frame, width, height, analysis, palette, intensity, params }: PresetProps) => {
  const fps = analysis.fps ?? 30;
  const layers = [
    { series: analysis.low, scale: 0.34, color: 0 },
    { series: analysis.mid, scale: 0.26, color: 1 },
    { series: analysis.high, scale: 0.18, color: 2 },
  ];

  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      <rect width={width} height={height} fill={background(palette)} />
      {layers.map((layer, li) => {
        const top: string[] = [];
        const bottom: string[] = [];
        for (let s = 0; s <= STEPS; s++) {
          const x = (s / STEPS) * width;
          const f = frame - (1 - s / STEPS) * params.window * fps;
          const amp = at(layer.series, f) * layer.scale * height * (0.5 + intensity) * params.amplitude;
          // Eased toward the left edge so the ribbon tapers instead of ending abruptly.
          const taper = Math.min(1, s / (STEPS * 0.25));
          top.push(`${x.toFixed(1)},${(height / 2 - amp * taper).toFixed(1)}`);
          bottom.push(`${x.toFixed(1)},${(height / 2 + amp * taper).toFixed(1)}`);
        }
        const d = `M ${top.join(" L ")} L ${bottom.reverse().join(" L ")} Z`;
        return <path key={li} d={d} fill={withAlpha(accent(palette, layer.color), 0.45)} stroke={withAlpha(accent(palette, layer.color), 0.9)} strokeWidth={2} />;
      })}
    </svg>
  );
};
