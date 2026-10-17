import { describe, expect, it } from "vitest";
import { PRESETS } from ".";
import { PRESET_PARAMS, resolveParams } from "./params";

describe("resolveParams", () => {
  it("fills defaults when nothing is given", () => {
    expect(resolveParams("tunnel", undefined)).toEqual({ layers: 14, speed: 1 });
    expect(resolveParams("particleField", {})).toEqual({ density: 1, size: 1 });
  });

  it("clamps to range and rounds whole-number params", () => {
    expect(resolveParams("tunnel", { layers: 999, speed: 0 })).toEqual({ layers: 24, speed: 0.2 });
    expect(resolveParams("spectrumRings", { rings: 5.6, bars: -3 })).toEqual({ rings: 6, bars: 6 });
  });

  it("ignores unknown keys and non-numeric or non-finite values", () => {
    expect(resolveParams("geometricGrid", { cells: "lots", spin: NaN, bogus: 5 })).toEqual({ cells: 14, spin: 1 });
  });

  it("has defaults inside their own ranges, for every preset the renderer knows", () => {
    expect(Object.keys(PRESET_PARAMS).sort()).toEqual(Object.keys(PRESETS).sort());
    for (const specs of Object.values(PRESET_PARAMS))
      for (const s of specs) {
        expect(s.default).toBeGreaterThanOrEqual(s.min);
        expect(s.default).toBeLessThanOrEqual(s.max);
      }
  });
});
