import { useMemo } from "react";
import type { Setting, TimeOfDay, Weather } from "../../../shared/types";
import { accent, brightestAccent, foreground, mix } from "../color";
import { wobble } from "../motion";
import { mulberry32 } from "../rng";

export type SceneColors = {
  skyTop: string;
  skyBottom: string;
  far: string;
  mid: string;
  near: string;
  ground: string;
  /** Lamp / window glow. */
  light: string;
  celestial: string;
  /** Darkest tone, used for background silhouettes. */
  ink: string;
  fg: string;
  time: TimeOfDay;
};

/** Derives a scene's colors from the style plan palette so scenes match the rest of the video. */
export function sceneColors(palette: string[], time: TimeOfDay): SceneColors {
  const p0 = palette[0];
  const fg = foreground(palette);
  const cool = accent(palette, 0);
  const warm = brightestAccent(palette);
  const black = "#000000";
  const base = { light: warm, fg, time, ink: mix(p0, black, 0.6) };
  switch (time) {
    case "day":
      return { ...base, skyTop: mix(cool, fg, 0.55), skyBottom: mix(fg, cool, 0.12), far: mix(cool, p0, 0.2), mid: mix(cool, p0, 0.4), near: mix(cool, p0, 0.6), ground: mix(cool, p0, 0.5), celestial: mix(warm, fg, 0.5) };
    case "dawn":
      return { ...base, skyTop: mix(cool, fg, 0.25), skyBottom: mix(warm, fg, 0.45), far: mix(cool, p0, 0.45), mid: mix(cool, p0, 0.6), near: mix(p0, black, 0.2), ground: mix(cool, p0, 0.7), celestial: mix(warm, fg, 0.3) };
    case "dusk":
      return { ...base, skyTop: mix(p0, cool, 0.5), skyBottom: warm, far: mix(p0, cool, 0.3), mid: mix(p0, black, 0.2), near: mix(p0, black, 0.45), ground: mix(p0, black, 0.35), celestial: mix(warm, fg, 0.35) };
    default:
      return { ...base, skyTop: p0, skyBottom: mix(p0, cool, 0.42), far: mix(p0, black, 0.18), mid: mix(p0, black, 0.35), near: mix(p0, black, 0.55), ground: mix(p0, black, 0.4), celestial: fg };
  }
}

/** Horizontal position of the sun/moon as a fraction of the width; shared so reflections line up with it. */
export const celestialX = (time: TimeOfDay) => (time === "night" ? 0.78 : time === "dusk" || time === "dawn" ? 0.3 : 0.72);

type SkyProps = { uid: string; w: number; h: number; hz: number; t: number; c: SceneColors; seed: number; /** Drawn this far past the frame edges. */ bleed: number };

export const Sky = ({ uid, w, h, hz, t, c, seed, bleed }: SkyProps) => {
  const stars = useMemo(() => {
    const rand = mulberry32(seed ^ 0x5bd1e995);
    return Array.from({ length: 80 }, () => ({ x: rand() * w, y: rand() * hz * 0.9, r: 0.6 + rand() * 1.4, ph: rand() * 6.28 }));
  }, [seed, w, hz]);
  const clouds = useMemo(() => {
    const rand = mulberry32(seed ^ 0x27d4eb2f);
    return Array.from({ length: 5 }, () => ({ x: rand() * w, y: hz * (0.15 + rand() * 0.45), s: 0.6 + rand() * 0.8, v: 4 + rand() * 6 }));
  }, [seed, w, hz]);
  const night = c.time === "night";
  const low = c.time === "dusk" || c.time === "dawn";
  const cx = w * celestialX(c.time);
  const cy = night ? hz * 0.28 : low ? hz * 0.92 : hz * 0.25;
  const cr = Math.min(w, h) * (night ? 0.045 : 0.06);

  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.skyTop} />
          <stop offset="1" stopColor={c.skyBottom} />
        </linearGradient>
        <radialGradient id={`${uid}-glow`}>
          <stop offset="0" stopColor={c.celestial} stopOpacity={0.55} />
          <stop offset="1" stopColor={c.celestial} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect x={-bleed} y={-bleed} width={w + 2 * bleed} height={h + 2 * bleed} fill={`url(#${uid}-sky)`} />
      {(night || c.time === "dawn") &&
        stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={c.fg} opacity={(night ? 0.35 : 0.12) + 0.4 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.ph))} />)}
      <circle cx={cx} cy={cy} r={cr * 4} fill={`url(#${uid}-glow)`} />
      <circle cx={cx} cy={cy} r={cr} fill={c.celestial} />
      {night && <circle cx={cx + cr * 0.35} cy={cy - cr * 0.1} r={cr * 0.9} fill={c.skyTop} opacity={0.25} />}
      {!night &&
        clouds.map((cl, i) => {
          const x = (((cl.x + t * cl.v) % (w * 1.3)) + w * 1.3) % (w * 1.3) - w * 0.15;
          return (
            <g key={i} opacity={0.35} fill={c.fg}>
              <ellipse cx={x} cy={cl.y} rx={70 * cl.s} ry={16 * cl.s} />
              <ellipse cx={x - 30 * cl.s} cy={cl.y + 4 * cl.s} rx={42 * cl.s} ry={13 * cl.s} />
              <ellipse cx={x + 34 * cl.s} cy={cl.y + 5 * cl.s} rx={46 * cl.s} ry={12 * cl.s} />
            </g>
          );
        })}
    </g>
  );
};

type WeatherProps = { uid: string; weather: Weather; w: number; h: number; t: number; c: SceneColors; seed: number };

export const WeatherOverlay = ({ uid, weather, w, h, t, c, seed }: WeatherProps) => {
  const drops = useMemo(() => {
    const rand = mulberry32(seed ^ 0x165667b1);
    return Array.from({ length: weather === "rain" ? 150 : 90 }, () => ({ x: rand(), y: rand(), s: 0.7 + rand() * 0.6, ph: rand() * 6.28 }));
  }, [seed, weather]);
  if (weather === "clear") return null;
  if (weather === "fog")
    return (
      <g>
        <defs>
          <linearGradient id={`${uid}-fog`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c.fg} stopOpacity={0} />
            <stop offset="0.5" stopColor={c.fg} stopOpacity={0.28} />
            <stop offset="1" stopColor={c.fg} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0.45, 0.62, 0.78].map((y, i) => (
          <rect key={i} x={((t * (8 + i * 5)) % w) - w} y={h * y - h * 0.1} width={w * 3} height={h * 0.2} fill={`url(#${uid}-fog)`} />
        ))}
      </g>
    );
  if (weather === "rain")
    return (
      <g stroke={c.fg} strokeWidth={1.4} opacity={0.4} strokeLinecap="round">
        {drops.map((d, i) => {
          const y = (((d.y + t * 1.1 * d.s) % 1) + 1) % 1;
          const x = d.x * w - y * h * 0.08;
          return <line key={i} x1={x} y1={y * h} x2={x - h * 0.012} y2={y * h + h * 0.035 * d.s} />;
        })}
      </g>
    );
  return (
    <g fill={c.fg} opacity={0.75}>
      {drops.map((d, i) => {
        const y = (((d.y + t * 0.09 * d.s) % 1) + 1) % 1;
        return <circle key={i} cx={d.x * w + Math.sin(t * 0.8 + d.ph) * 18} cy={y * h} r={1.2 + d.s * 1.4} />;
      })}
    </g>
  );
};

type AmbientProps = { setting: Setting; time: TimeOfDay; weather: Weather; w: number; gy: number; hz: number; t: number; c: SceneColors; seed: number; /** Beat envelope, 1 on a beat. */ pulse: number };

/** Small living details in the air: fireflies over grass and trees at night, dust turning in the light of a room. */
export const Ambient = ({ setting, time, weather, w, gy, hz, t, c, seed, pulse }: AmbientProps) => {
  const motes = useMemo(() => {
    const rand = mulberry32(seed ^ 0x3c6ef372);
    return Array.from({ length: 16 }, () => ({ x: rand(), y: rand(), r: 0.6 + rand() * 0.8, ph: rand() * 50 }));
  }, [seed]);
  const dark = time === "night" || time === "dusk";
  const flies = dark && weather === "clear" && (setting === "forest" || setting === "field");
  const dust = setting === "room";
  if (!flies && !dust) return null;
  const top = dust ? gy * 0.25 : hz;
  const unit = (gy - hz) * 0.02 + 1.5;
  return (
    <g fill={flies ? c.light : c.fg}>
      {motes.map((m, i) => {
        const x = (m.x + 0.04 * wobble(seed, t + m.ph, 30 + i, 0.12)) * w;
        const y = top + (gy - top) * (m.y * 0.9 + 0.05 * wobble(seed, t + m.ph, 60 + i, 0.15));
        const glow = flies ? Math.max(0, wobble(seed, t + m.ph, 90 + i, 0.4)) * (0.7 + 0.3 * pulse) : 0.18 + 0.12 * wobble(seed, t, 90 + i, 0.2);
        return glow > 0.02 ? <circle key={i} cx={x} cy={y} r={unit * m.r * (flies ? 1 : 0.6)} opacity={Math.min(1, glow)} /> : null;
      })}
    </g>
  );
};
