import { describe, expect, it } from "vitest";
import { SHUTTER, shutterOffsets } from "./MusicVideo";

describe("shutterOffsets", () => {
  it("is just the frame itself when blur is off", () => {
    expect(shutterOffsets("off", 30)).toEqual([0]);
  });

  it("spreads the samples evenly across the open shutter, centred on the frame's time", () => {
    for (const setting of ["light", "strong"] as const) {
      const off = shutterOffsets(setting, 30);
      expect(off).toHaveLength(SHUTTER[setting].samples);
      expect(off[0]).toBeCloseTo(-off[off.length - 1], 9);
      expect(off[off.length - 1] - off[0]).toBeCloseTo(SHUTTER[setting].open / 30, 9);
      expect(off).toContain(0); // the sharp reference frame
      expect([...off].sort((a, b) => a - b)).toEqual(off);
    }
  });

  it("is a longer exposure for strong than light, and shorter at a higher frame rate", () => {
    const span = (o: number[]) => o[o.length - 1] - o[0];
    expect(span(shutterOffsets("strong", 30))).toBeGreaterThan(span(shutterOffsets("light", 30)));
    expect(span(shutterOffsets("light", 60))).toBeLessThan(span(shutterOffsets("light", 30)));
  });
});
