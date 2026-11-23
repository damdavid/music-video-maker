import { describe, expect, it } from "vitest";
import { sceneryMood } from "./scenery";

describe("sceneryMood", () => {
  it("gusts only on a hard hit and glows on a beat", () => {
    expect(sceneryMood(0.5, 0.2, 0).gust).toBe(0);
    expect(sceneryMood(0.5, 1, 0).gust).toBe(1);
    expect(sceneryMood(0.5, 0, 1).glow).toBeGreaterThan(sceneryMood(0.5, 0, 0).glow);
  });

  it("flickers more on hard hits and stays in range", () => {
    expect(sceneryMood(0.5, 1, 0).flicker).toBeGreaterThan(sceneryMood(0.5, 0, 0).flicker);
    for (const e of [-1, 0, 0.5, 1, 3])
      for (const o of [0, 0.5, 1])
        for (const p of [0, 1]) {
          const m = sceneryMood(e, o, p);
          for (const v of Object.values(m)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
  });
});
