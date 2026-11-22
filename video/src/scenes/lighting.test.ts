import { describe, expect, it } from "vitest";
import { DRIFT, driftColors, lightingAt } from "./lighting";
import { sceneColors } from "./sky";

const PALETTE = ["#101820", "#ff3366", "#f2f2f2", "#3366ff"];

describe("driftColors", () => {
  it("starts as the scene's own light and ends a part of the way toward the next time of day", () => {
    expect(driftColors(PALETTE, "dusk", 0)).toEqual(sceneColors(PALETTE, "dusk"));
    const end = driftColors(PALETTE, "dusk", 1);
    const night = sceneColors(PALETTE, "night");
    const dusk = sceneColors(PALETTE, "dusk");
    expect(end.skyBottom).not.toBe(dusk.skyBottom);
    expect(end.skyBottom).not.toBe(night.skyBottom); // only part of the way
    expect(DRIFT).toBeGreaterThan(0);
    expect(DRIFT).toBeLessThan(0.6);
  });

  it("keeps the scene's structure and drifts smoothly", () => {
    expect(driftColors(PALETTE, "dusk", 1).time).toBe("dusk");
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    let last = lum(driftColors(PALETTE, "dusk", 0).skyBottom);
    for (let p = 0.1; p <= 1.001; p += 0.1) {
      const now = lum(driftColors(PALETTE, "dusk", p).skyBottom);
      expect(Math.abs(now - last)).toBeLessThan(40);
      last = now;
    }
  });

  it("wraps from night toward dawn without a gap", () => {
    expect(driftColors(PALETTE, "night", 1).skyTop).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("lightingAt", () => {
  it("brightens on a beat and more on a downbeat, and is quiet between them", () => {
    const rest = lightingAt("night", 0, 0, 0, 0.6);
    const beat = lightingAt("night", 1, 0, 0, 0.6);
    const down = lightingAt("night", 1, 1, 0, 0.6);
    expect(beat.flash).toBeGreaterThan(rest.flash);
    expect(down.flash).toBeGreaterThan(beat.flash);
    expect(rest.flash).toBe(0);
  });

  it("flares only on a hard hit, scaled by loudness", () => {
    expect(lightingAt("night", 0, 0, 0.4, 0.8).flare).toBe(0);
    expect(lightingAt("night", 0, 0, 1, 0.9).flare).toBeGreaterThan(lightingAt("night", 0, 0, 1, 0.2).flare);
  });

  it("shows less in daylight than at night, and always stays in range", () => {
    expect(lightingAt("day", 1, 1, 1, 1).rim).toBeLessThan(lightingAt("night", 1, 1, 1, 1).rim);
    for (const time of ["dawn", "day", "dusk", "night"] as const)
      for (const v of [0, 0.5, 1]) {
        const l = lightingAt(time, v, v, v, v);
        expect(l.flash).toBeLessThanOrEqual(0.1);
        expect(l.flare).toBeLessThanOrEqual(1);
        expect(l.rim).toBeLessThanOrEqual(0.7);
        expect(Math.min(l.flash, l.flare, l.rim)).toBeGreaterThanOrEqual(0);
      }
  });

  it("is quiet when the music is", () => {
    expect(lightingAt("night", 0, 0, 0, 0).rim).toBeLessThan(lightingAt("night", 0, 0, 0, 1).rim);
  });
});
