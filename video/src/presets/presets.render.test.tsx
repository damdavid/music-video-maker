import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnalysisData } from "../../../shared/types";
import { PRESETS } from ".";
import { PRESET_PARAMS, resolveParams } from "./params";

const N = 600;
const series = Array.from({ length: N }, (_, i) => 0.4 + 0.3 * Math.sin(i / 7));
const analysis = {
  duration: 20, bpm: 120, key: "A", fps: 30,
  beats: Array.from({ length: 40 }, (_, i) => 0.5 + i * 0.5),
  downbeats: Array.from({ length: 10 }, (_, i) => 0.5 + i * 2),
  onsets: [], sections: [{ start: 0, end: 20, label: "s" }],
  rms: series, low: series, mid: series, high: series, spectral_centroid: series, onset_strength: series,
  chroma: Array.from({ length: N }, () => Array.from({ length: 12 }, (_, k) => 0.2 + 0.05 * k)),
} as unknown as AnalysisData;
const palette = ["#0b1020", "#0078BF", "#FF48B0", "#FFE800", "#F2EDE3"];

const render = (name: keyof typeof PRESETS, w: number, h: number, intensity = 0.7, params: Record<string, number> = {}) => {
  const Preset = PRESETS[name];
  return renderToStaticMarkup(
    <Preset uid="u" frame={95} t={3.17} width={w} height={h} analysis={analysis} palette={palette} intensity={intensity} seed={1234} params={{ ...resolveParams(name, undefined), ...params }} />,
  );
};

describe.each(Object.keys(PRESETS) as (keyof typeof PRESETS)[])("%s", (name) => {
  it.each([[1920, 1080], [1080, 1920], [1080, 1080]])("renders finite, bounded markup at %dx%d", (w, h) => {
    const html = render(name, w, h);
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
    expect((html.match(/</g) ?? []).length).toBeLessThan(2500);
  });

  it("renders at the extremes of every parameter without breaking", () => {
    for (const spec of PRESET_PARAMS[name]) {
      for (const v of [spec.min, spec.max]) {
        const html = render(name, 1280, 720, 1, { [spec.key]: v });
        expect(html).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  });

  it("is a pure function of its inputs", () => {
    expect(render(name, 1280, 720)).toBe(render(name, 1280, 720));
  });
});

describe("new riso presets", () => {
  it("ripples draws a ring and the lens only when asked", () => {
    expect(render("ripples", 1280, 720, 0.7, { lens: 1 }).match(/<circle/g)?.length).toBeGreaterThan(render("ripples", 1280, 720, 0.7, { lens: 0 }).match(/<circle/g)!.length);
  });

  it("halftoneBloom has more dots at higher density, and orbits more medallions with more orbits", () => {
    expect(render("halftoneBloom", 1280, 720, 0.7, { dots: 1.4 }).match(/<circle/g)!.length).toBeGreaterThan(render("halftoneBloom", 1280, 720, 0.7, { dots: 0.5 }).match(/<circle/g)!.length);
    expect(render("orbits", 1280, 720, 0.7, { orbits: 5 }).match(/<circle/g)!.length).toBeGreaterThan(render("orbits", 1280, 720, 0.7, { orbits: 2 }).match(/<circle/g)!.length);
  });
});
