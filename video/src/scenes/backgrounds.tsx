import { useMemo } from "react";
import type { Setting } from "../../../shared/types";
import { mix, withAlpha } from "../color";
import { wobble } from "../motion";
import { mulberry32 } from "../rng";
import { celestialX, type SceneColors } from "./sky";

export type BgProps = {
  uid: string;
  setting: Setting;
  w: number;
  h: number;
  /** Ground line where characters stand, and the horizon. */
  gy: number;
  hz: number;
  t: number;
  /** Pixels the world has moved past at the ground line (grows while the lead walks; negative walking left). */
  travel: number;
  c: SceneColors;
  seed: number;
  /** Camera transform for a layer at a depth (0 far .. 1 the ground line); see depthTransform. */
  layer: (depth: number) => string | undefined;
  /** Bars elapsed, for changes that should happen in time with the music. */
  bar: number;
  /** 0 calm .. 1 stormy: how hard trees and grass move. */
  wind: number;
};

/** How far scenery is drawn past each edge of the frame, so camera moves never reveal an edge. */
export const bleedOf = (w: number, h: number) => Math.round(Math.max(w, h) * 0.15);

const hillPath = (from: number, to: number, baseY: number, amp: number, freq: number, phase: number, bottom: number) => {
  const pts: string[] = [];
  for (let x = from; x <= to + 24; x += 24) pts.push(`${x},${(baseY - amp * (0.5 + 0.5 * Math.sin(x * freq + phase))).toFixed(1)}`);
  return `M ${from},${bottom} L ${pts.join(" L ")} L ${to + 24},${bottom} Z`;
};

const wrap = (x: number, period: number) => ((x % period) + period) % period;
/** Tiled scenery is drawn three times side by side so it covers the frame and its bleed at any offset. */
const COPIES = [-1, 0, 1];

type Building = { x: number; w: number; h: number; lit: boolean[] };

function makeBuildings(rand: () => number, width: number, minW: number, maxW: number, minH: number, maxH: number, h: number): Building[] {
  const out: Building[] = [];
  let x = 0;
  while (x < width) {
    const bw = (minW + rand() * (maxW - minW)) * h;
    const bh = (minH + rand() * (maxH - minH)) * h;
    out.push({ x, w: bw, h: bh, lit: Array.from({ length: 60 }, () => rand() < 0.38) });
    x += bw + rand() * 0.02 * h;
  }
  return out;
}

type BuildingsProps = { list: Building[]; tile: number; offset: number; baseY: number; bottom: number; color: string; windows: boolean; glow: string; h: number; bar: number; seed: number };

const Buildings = ({ list, tile, offset, baseY, bottom, color, windows, glow, h, bar, seed }: BuildingsProps) => {
  // One path per building for all its windows: the grid would otherwise be hundreds of elements per frame.
  const shapes = useMemo(
    () =>
      list.map((b, bi) => {
        if (!windows) return { b, lights: "" };
        const cols = Math.max(2, Math.floor(b.w / (0.04 * h)));
        const rows = Math.max(2, Math.floor(b.h / (0.06 * h)));
        // A few windows switch on or off each bar, so a night skyline is never frozen.
        const flick = mulberry32((seed ^ Math.imul(bar + 1, 0x2c1b3c6d) ^ Math.imul(bi + 1, 0x297a2d39)) >>> 0);
        const ww = (b.w / cols) * 0.4;
        const wh = (b.h / rows) * 0.38;
        let d = "";
        for (let k = 0; k < cols * rows; k++) {
          const lit = b.lit[k % b.lit.length] !== flick() < 0.04;
          if (!lit) continue;
          const x = b.x + ((k % cols) + 0.3) * (b.w / cols);
          const y = baseY - b.h + (Math.floor(k / cols) + 0.35) * (b.h / rows);
          d += `M${x.toFixed(1)} ${y.toFixed(1)}h${ww.toFixed(1)}v${wh.toFixed(1)}h${(-ww).toFixed(1)}Z`;
        }
        return { b, lights: d };
      }),
    [list, windows, h, baseY, bar, seed],
  );
  return (
    <g>
      {COPIES.map((copy) => (
        <g key={copy} transform={`translate(${copy * tile - wrap(offset, tile)} 0)`}>
          {shapes.map(({ b, lights }, i) => (
            <g key={i}>
              {/* Down past the frame, so the base never shows when nearer layers move more than this one. */}
              <rect x={b.x} y={baseY - b.h} width={b.w} height={bottom - (baseY - b.h)} fill={color} />
              {lights && <path d={lights} fill={glow} opacity={0.85} />}
            </g>
          ))}
        </g>
      ))}
    </g>
  );
};

type Tree = { x: number; s: number };

type PinesProps = { list: Tree[]; tile: number; offset: number; baseY: number; color: string; h: number; t: number; seed: number; wind: number };

const Pines = ({ list, tile, offset, baseY, color, h, t, seed, wind }: PinesProps) => (
  <g fill={color}>
    {COPIES.map((copy) => (
      <g key={copy} transform={`translate(${copy * tile - wrap(offset, tile)} 0)`}>
        {list.map((tr, i) => {
          const th = tr.s * h * 0.34;
          const tw = th * 0.42;
          // Each tree sways about its base on its own gust, harder in bad weather.
          const sway = wobble(seed, t + i * 0.73, 21, 0.3) * (1.2 + 3.5 * wind);
          return (
            <g key={i} transform={`translate(${tr.x} ${baseY}) rotate(${sway.toFixed(2)})`}>
              <rect x={-tw * 0.07} y={-th * 0.12} width={tw * 0.14} height={th * 0.14} />
              {[0, 1, 2].map((k) => (
                <polygon key={k} points={`${-tw * (0.5 - k * 0.1)},${-th * (0.1 + k * 0.28)} ${tw * (0.5 - k * 0.1)},${-th * (0.1 + k * 0.28)} 0,${-th * (0.45 + k * 0.28)}`} />
              ))}
            </g>
          );
        })}
      </g>
    ))}
  </g>
);

/** A strip of grass tufts along the ground line that bend with the wind. */
const Grass = ({ from, to, y, offset, h, t, seed, wind, color }: { from: number; to: number; y: number; offset: number; h: number; t: number; seed: number; wind: number; color: string }) => {
  const step = h * 0.035;
  const blade = h * 0.03;
  let d = "";
  for (let k = Math.floor((from + offset) / step); k * step - offset <= to; k++) {
    const x = k * step - offset;
    const lean = (wobble(seed, t * 0.6 + x * 0.002, 22, 0.5) * (0.35 + 0.6 * wind) + 0.15) * blade;
    const tall = blade * (0.7 + 0.5 * (((k * 2654435761) >>> 0) % 100) / 100);
    for (const dx of [-0.25, 0, 0.3]) d += `M${(x + dx * step).toFixed(1)} ${y.toFixed(1)}q${(lean * 0.3).toFixed(1)} ${(-tall * 0.6).toFixed(1)} ${(lean + dx * 4).toFixed(1)} ${(-tall).toFixed(1)}`;
  }
  return <path d={d} stroke={color} strokeWidth={Math.max(1.5, h * 0.003)} strokeLinecap="round" fill="none" />;
};

export const Background = ({ uid, setting, w, h, gy, hz, t, travel, c, seed, layer, bar, wind }: BgProps) => {
  const data = useMemo(() => {
    const rand = mulberry32(seed ^ 0x9e3779b9);
    const tileW = w * 1.7;
    return {
      tileW,
      far: makeBuildings(rand, tileW, 0.07, 0.16, 0.14, 0.34, h),
      mid: makeBuildings(rand, tileW, 0.1, 0.2, 0.22, 0.5, h),
      farTrees: Array.from({ length: 26 }, (_, i) => ({ x: (i / 26) * tileW + rand() * 30, s: 0.45 + rand() * 0.3 })),
      nearTrees: Array.from({ length: 10 }, (_, i) => ({ x: (i / 10) * tileW + rand() * 90, s: 0.9 + rand() * 0.5 })),
    };
  }, [seed, w, h]);
  const night = c.time === "night" || c.time === "dusk";
  const B = bleedOf(w, h);
  const L = -B;
  const W = w + 2 * B;
  const bottom = h + B;
  const at = (depth: number) => ({ transform: layer(depth) });

  switch (setting) {
    case "city": {
      const sky = { tile: data.tileW, glow: c.light, windows: night, h, bar, seed, bottom };
      return (
        <g>
          <g {...at(0.08)}>
            <Buildings list={data.far} offset={travel * 0.08} baseY={hz + 4} color={c.far} {...sky} />
          </g>
          <g {...at(0.2)}>
            <Buildings list={data.mid} offset={travel * 0.2} baseY={hz + 6} color={c.mid} {...sky} />
          </g>
          <rect {...at(0.3)} x={L} y={hz} width={W} height={bottom - hz} fill={c.ground} />
          <g {...at(1)}>
            <rect x={L} y={gy + 0.01 * h} width={W} height={bottom - gy} fill={mix(c.ground, c.ink, 0.35)} />
            <rect x={L} y={gy} width={W} height={0.012 * h} fill={mix(c.ground, c.light, 0.18)} />
          </g>
        </g>
      );
    }
    case "forest": {
      const trees = { tile: data.tileW, h, t, seed, wind };
      return (
        <g>
          <rect {...at(0.1)} x={L} y={hz} width={W} height={bottom - hz} fill={c.ground} />
          <g {...at(0.1)}>
            <Pines list={data.farTrees} offset={travel * 0.1} baseY={hz + 0.03 * h} color={c.far} {...trees} />
          </g>
          <g {...at(0.25)}>
            <Pines list={data.farTrees.slice().reverse()} offset={travel * 0.25 + 60} baseY={hz + 0.1 * h} color={c.mid} {...trees} />
            <rect x={L} y={hz + 0.1 * h} width={W} height={bottom - hz} fill={c.ground} />
          </g>
          <g {...at(1)}>
            <Pines list={data.nearTrees} offset={travel} baseY={gy + 0.02 * h} color={c.near} {...trees} />
            <rect x={L} y={gy + 0.02 * h} width={W} height={bottom - gy} fill={mix(c.ground, c.ink, 0.3)} />
          </g>
        </g>
      );
    }
    case "field": {
      // A hill's phase is its offset in radians: distance travelled at its depth times its spatial frequency.
      return (
        <g>
          <path {...at(0.1)} d={hillPath(L, w + B, hz + 0.02 * h, 0.05 * h, 0.004, 1 + travel * 0.1 * 0.004, bottom)} fill={c.far} />
          <path {...at(0.3)} d={hillPath(L, w + B, hz + 0.1 * h, 0.07 * h, 0.006, 3 + travel * 0.3 * 0.006, bottom)} fill={c.mid} />
          <path {...at(0.7)} d={hillPath(L, w + B, gy - 0.03 * h, 0.05 * h, 0.009, 5 + travel * 0.7 * 0.009, bottom)} fill={c.near} />
          <g {...at(1)}>
            <rect x={L} y={gy + 0.01 * h} width={W} height={bottom - gy} fill={mix(c.near, c.ink, 0.25)} />
            <Grass from={L} to={w + B} y={gy + 0.012 * h} offset={travel} h={h} t={t} seed={seed} wind={wind} color={mix(c.near, c.ink, 0.45)} />
          </g>
        </g>
      );
    }
    case "shore": {
      const seaBottom = gy - 0.02 * h;
      return (
        <g>
          <defs>
            <linearGradient id={`${uid}-sea`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={mix(c.skyBottom, c.far, 0.35)} />
              <stop offset="1" stopColor={mix(c.far, c.ink, 0.35)} />
            </linearGradient>
            <linearGradient id={`${uid}-refl`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={c.celestial} stopOpacity={c.time === "night" ? 0.4 : 0.3} />
              <stop offset="1" stopColor={c.celestial} stopOpacity={0} />
            </linearGradient>
          </defs>
          <g {...at(0.15)}>
            {/* Down to the frame bottom, behind the beach, so no gap opens when the beach moves more. */}
            <rect x={L} y={hz} width={W} height={bottom - hz} fill={`url(#${uid}-sea)`} />
            {Array.from({ length: 9 }, (_, k) => {
              const d = (k + 1) / 9;
              const y = hz + (seaBottom - hz) * d * d;
              const amp = 1 + d * 5;
              const shift = travel * (0.15 + 0.6 * d * d);
              let path = "";
              for (let x = L; x <= w + B; x += 30) path += `${x === L ? "M" : "L"} ${x},${(y + amp * Math.sin((x + shift) * 0.012 * (1 + d) + t * (0.8 + d))).toFixed(1)} `;
              return <path key={k} d={path} stroke={withAlpha(c.fg, 0.1 + 0.18 * d)} strokeWidth={1 + d * 2} fill="none" />;
            })}
            {Array.from({ length: 9 }, (_, k) => {
              // Shimmer: short horizontal glints that widen toward the viewer and drift with the waves.
              const d = (k + 1) / 9;
              const y = hz + (seaBottom - hz) * d * d;
              const width = w * (0.015 + 0.05 * d) * (0.7 + 0.3 * Math.sin(t * 1.7 + k * 2.1));
              return <rect key={k} x={w * celestialX(c.time) - width / 2 + Math.sin(t * 0.9 + k) * 6} y={y - 1} width={width} height={1 + d * 3} rx={2} fill={c.celestial} opacity={0.18 + 0.4 * (1 - d * 0.5)} />;
            })}
            <rect x={w * (celestialX(c.time) - 0.025)} y={hz} width={w * 0.05} height={seaBottom - hz} fill={`url(#${uid}-refl)`} />
          </g>
          <path
            {...at(1)}
            d={`M ${L},${bottom} L ${L},${seaBottom} ${Array.from({ length: Math.ceil(W / 40) + 1 }, (_, i) => `L ${L + i * 40},${(seaBottom + 6 * Math.sin(i * 0.7 + (travel / 40) * 0.7 + t * 1.2)).toFixed(1)}`).join(" ")} L ${w + B},${bottom} Z`}
            fill={mix(c.far, c.light, 0.22)}
          />
        </g>
      );
    }
    case "room": {
      const wallBottom = gy + 0.005 * h;
      const wx = w * 0.62;
      const ww = w * 0.24;
      const wy = h * 0.14;
      const wh = h * 0.36;
      return (
        <g>
          <g {...at(0.9)}>
            <rect x={L} y={-B} width={W} height={h + 2 * B} fill={mix(c.mid, c.skyTop, 0.3)} />
            {Array.from({ length: 22 }, (_, i) => <rect key={i} x={((i - 4) / 14) * w} y={-B} width={w / 28} height={wallBottom + B} fill={withAlpha(c.fg, 0.03)} />)}
            <defs>
              <clipPath id={`${uid}-win`}>
                <rect x={wx} y={wy} width={ww} height={wh} />
              </clipPath>
              <linearGradient id={`${uid}-wsky`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c.skyTop} />
                <stop offset="1" stopColor={c.skyBottom} />
              </linearGradient>
            </defs>
            <rect x={wx} y={wy} width={ww} height={wh} fill={`url(#${uid}-wsky)`} />
            <g clipPath={`url(#${uid}-win)`}>
              <circle cx={wx + ww * 0.7} cy={wy + wh * 0.28} r={ww * 0.07} fill={c.celestial} opacity={0.9} />
              <Buildings list={data.far} tile={data.tileW} offset={travel * 0.02} baseY={wy + wh} bottom={wy + wh + 4} color={c.far} windows={night} glow={c.light} h={h * 0.9} bar={bar} seed={seed} />
            </g>
            <rect x={wx} y={wy} width={ww} height={wh} fill="none" stroke={c.ink} strokeWidth={0.012 * h} />
            <line x1={wx + ww / 2} y1={wy} x2={wx + ww / 2} y2={wy + wh} stroke={c.ink} strokeWidth={0.008 * h} />
            <line x1={wx} y1={wy + wh / 2} x2={wx + ww} y2={wy + wh / 2} stroke={c.ink} strokeWidth={0.008 * h} />
            <rect x={w * 0.1} y={h * 0.2} width={w * 0.1} height={h * 0.14} fill={mix(c.mid, c.light, 0.3)} stroke={c.ink} strokeWidth={0.008 * h} />
            <rect x={L} y={wallBottom - 0.02 * h} width={W} height={0.02 * h} fill={mix(c.mid, c.ink, 0.3)} />
          </g>
          <g {...at(1)}>
            <rect x={L} y={wallBottom} width={W} height={bottom - wallBottom} fill={mix(c.ground, c.ink, 0.25)} />
            <ellipse cx={w * 0.5} cy={gy + 0.06 * h} rx={w * 0.26} ry={0.035 * h} fill={mix(c.light, c.ground, 0.65)} opacity={0.7} />
          </g>
        </g>
      );
    }
    case "road": {
      const roadHalfBottom = w * 0.38;
      const lerp = (a: number, b: number, z: number) => a + (b - a) * z;
      // The dashes come toward the viewer at the walking pace: one dash spacing per this many ground pixels.
      const dashTravel = h * 0.35;
      return (
        <g>
          <path {...at(0.12)} d={hillPath(L, w + B, hz + 0.01 * h, 0.045 * h, 0.005, 2 + travel * 0.12 * 0.005, hz + 4)} fill={c.far} />
          <g {...at(1)}>
            <rect x={L} y={hz} width={W} height={bottom - hz} fill={c.ground} />
            <polygon points={`${w * 0.49},${hz} ${w * 0.51},${hz} ${w / 2 + roadHalfBottom},${bottom} ${w / 2 - roadHalfBottom},${bottom}`} fill={mix(c.ground, c.light, 0.08)} />
            {[-1, 1].map((side) => <line key={side} x1={w / 2 + side * w * 0.01} y1={hz} x2={w / 2 + side * roadHalfBottom * 0.96} y2={h} stroke={withAlpha(c.fg, 0.28)} strokeWidth={3} />)}
            {Array.from({ length: 12 }, (_, k) => {
              const z0 = wrap(k + Math.abs(travel) / dashTravel, 12) / 12;
              const z1 = z0 + 0.04;
              const y0 = hz + (h - hz) * z0 * z0;
              const y1 = hz + (h - hz) * z1 * z1;
              const hw0 = lerp(1, w * 0.012, z0 * z0);
              const hw1 = lerp(1, w * 0.012, z1 * z1);
              return <polygon key={k} points={`${w / 2 - hw0},${y0} ${w / 2 + hw0},${y0} ${w / 2 + hw1},${y1} ${w / 2 - hw1},${y1}`} fill={withAlpha(c.light, 0.55)} />;
            })}
          </g>
        </g>
      );
    }
    default:
      return (
        <g {...at(0.5)}>
          <defs>
            <linearGradient id={`${uid}-void`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={mix(c.ground, c.skyBottom, 0.35)} />
              <stop offset="1" stopColor={c.ink} />
            </linearGradient>
          </defs>
          <rect x={L} y={hz} width={W} height={bottom - hz} fill={`url(#${uid}-void)`} />
          <line x1={L} y1={hz} x2={w + B} y2={hz} stroke={withAlpha(c.fg, 0.2)} strokeWidth={2} />
        </g>
      );
  }
};
