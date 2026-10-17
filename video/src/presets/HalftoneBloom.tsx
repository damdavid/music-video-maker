import { useMemo } from "react";
import { feature } from "../features";
import { accent, background, brightestAccent, withAlpha } from "../color";
import { printScale } from "../riso/print";
import { beatPulse, clamp } from "../timing";
import type { PresetProps } from "./types";

const petal = (len: number) => {
  const w = len * 0.42;
  return `M0 0 C ${w} ${-len * 0.3} ${w} ${-len * 0.75} 0 ${-len} C ${-w} ${-len * 0.75} ${-w} ${-len * 0.3} 0 0 Z`;
};

/** A flower of overprinted petals spinning over a dot screen whose dots swell with the music. */
export const HalftoneBloom = ({ t, frame, width, height, analysis, palette, intensity, params }: PresetProps) => {
  const unit = Math.min(width, height);
  const k = printScale(unit);
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.hypot(width, height) / 2;
  const mid = feature(analysis, "mid", frame);
  const low = feature(analysis, "low", frame);
  const pulse = beatPulse(analysis.beats, t);
  const open = clamp(0.72 + 0.28 * low + 0.2 * pulse * intensity, 0.4, 1.15);
  const rot = t * 0.12 * params.spin;

  const pitch = (unit * 0.05) / params.dots;
  // The screen's dot positions and falloff never change, only their size; laid out once per frame size.
  const grid = useMemo(() => {
    const tilt = (15 * Math.PI) / 180;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const span = Math.ceil(maxR / pitch);
    const out: { x: number; y: number; r: number }[] = [];
    for (let iy = -span; iy <= span; iy++) {
      for (let ix = -span; ix <= span; ix++) {
        const gx = ix * pitch;
        const gy = iy * pitch;
        const x = cx + gx * cos - gy * sin;
        const y = cy + gx * sin + gy * cos;
        if (x < -pitch || x > width + pitch || y < -pitch || y > height + pitch) continue;
        const d = Math.hypot(x - cx, y - cy) / maxR;
        out.push({ x, y, r: pitch * 0.46 * clamp(1.15 - d * 1.1) });
      }
    }
    return out;
  }, [pitch, maxR, cx, cy, width, height]);
  const swell = 0.55 + 0.6 * mid;
  const dots = grid.flatMap((d) => (d.r * swell >= 0.6 ? [{ x: d.x, y: d.y, r: d.r * swell }] : []));

  const n = params.petals;
  const petals = (len: number, offset: number, fill: string, dx = 0, dy = 0) =>
    Array.from({ length: n }, (_, i) => (
      <path key={i} d={petal(len)} fill={fill} transform={`translate(${cx + dx} ${cy + dy}) rotate(${((i / n) * 360 + offset).toFixed(2)})`} />
    ));
  const outer = unit * 0.36 * open;
  const inner = outer * 0.58;

  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      <rect width={width} height={height} fill={background(palette)} />
      <g fill={withAlpha(accent(palette, 0), 0.55)}>
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} />
        ))}
      </g>
      {/* The second ink is printed a pixel or two off register under the first. */}
      {petals(outer, (rot * 180) / Math.PI, withAlpha(accent(palette, 0), 0.9), 2.4 * k, 1.6 * k)}
      {petals(outer, (rot * 180) / Math.PI, withAlpha(accent(palette, 1), 0.92))}
      {petals(inner, -(rot * 180) / Math.PI + 180 / n, withAlpha(accent(palette, 2), 0.95))}
      {Array.from({ length: n }, (_, i) => {
        const a = (((i / n) * 360 - 90 + (rot * 180) / Math.PI) * Math.PI) / 180;
        return [0.45, 0.65, 0.85].map((f, j) => (
          <circle key={`${i}-${j}`} cx={cx + Math.cos(a) * outer * f} cy={cy + Math.sin(a) * outer * f} r={unit * (0.011 - j * 0.003) * (0.7 + 0.5 * mid)} fill={background(palette)} opacity={0.7} />
        ));
      })}
      <circle cx={cx} cy={cy} r={unit * (0.04 + 0.01 * pulse)} fill={brightestAccent(palette)} />
      <circle cx={cx} cy={cy} r={unit * 0.06} fill="none" stroke={withAlpha(accent(palette, 1), 0.8)} strokeWidth={unit * 0.004} />
    </svg>
  );
};
