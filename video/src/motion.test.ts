import { describe, expect, it } from "vitest";
import { envelope, seriesFrame, smoothed } from "./features";
import { impulse, impulses, jiggle, smooth, wobble, wobble2 } from "./motion";
import type { AnalysisData } from "../../shared/types";

describe("motion helpers", () => {
  it("wobble is smooth, bounded, deterministic and has independent channels", () => {
    for (let i = 0; i < 500; i++) {
      const t = i / 30;
      expect(Math.abs(wobble(5, t, 1))).toBeLessThanOrEqual(1);
      expect(Math.abs(wobble2(5, t, 1))).toBeLessThanOrEqual(1);
      expect(Math.abs(wobble(5, t + 1 / 30, 1) - wobble(5, t, 1))).toBeLessThan(0.2);
    }
    expect(wobble(5, 1.23, 1)).toBe(wobble(5, 1.23, 1));
    expect(wobble(5, 1.23, 1)).not.toBe(wobble(5, 1.23, 2));
  });

  it("impulse rises to exactly 1 after `rise` seconds and decays, zero before the event", () => {
    expect(impulse(-0.1, 0.1)).toBe(0);
    expect(impulse(0, 0.1)).toBe(0);
    expect(impulse(0.1, 0.1)).toBeCloseTo(1, 9);
    expect(impulse(0.5, 0.1)).toBeLessThan(0.1);
    expect(impulses([0, 1, 2], 2.1, 0.1)).toBeCloseTo(1, 3);
    expect(impulses([0, 1, 2], 2.1, 0.1, (i) => (i === 2 ? 0.5 : 1))).toBeCloseTo(0.5, 3);
  });

  it("jiggle starts at 1 and settles toward 0", () => {
    expect(jiggle(0, 3, 0.3)).toBe(1);
    expect(jiggle(-1, 3, 0.3)).toBe(0);
    expect(Math.abs(jiggle(2, 3, 0.3))).toBeLessThan(0.01);
    expect(Math.min(...Array.from({ length: 50 }, (_, i) => jiggle(i / 100, 3, 0.3)))).toBeLessThan(-0.2); // it overshoots
  });

  it("smooth eases 0..1 and clamps", () => {
    expect(smooth(-1)).toBe(0);
    expect(smooth(0.5)).toBe(0.5);
    expect(smooth(2)).toBe(1);
  });
});

describe("audio envelopes", () => {
  it("rises fast and falls slowly", () => {
    const step = [...new Array(30).fill(0), ...new Array(30).fill(1), ...new Array(60).fill(0)];
    const e = envelope(step, 30, 0.04, 0.3);
    expect(e[31]).toBeGreaterThan(0.5); // attack: most of the way up a frame after the hit
    expect(e[59]).toBeGreaterThan(0.99);
    expect(e[60 + 9]).toBeGreaterThan(0.3); // release: still a third up 0.3 s later
    expect(e[119]).toBeLessThan(0.05);
  });

  it("indexes series by the analysis rate, whatever the video's fps", () => {
    const rms = Array.from({ length: 300 }, (_, i) => i / 300);
    const a = { fps: 30, rms } as unknown as AnalysisData;
    expect(seriesFrame(a, 2)).toBe(60);
    expect(smoothed(a, "rms", 9)).toBeGreaterThan(0.85); // late in the song, not stuck at the start
  });
});
