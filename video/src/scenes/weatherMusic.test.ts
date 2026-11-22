import { describe, expect, it } from "vitest";
import { dropOpacity, weatherMood } from "./weatherMusic";

describe("weatherMood", () => {
  it("is heavier when louder and always in range", () => {
    expect(weatherMood(0.9, 0).amount).toBeGreaterThan(weatherMood(0.1, 0).amount);
    for (const e of [0, 0.5, 1])
      for (const o of [0, 0.5, 1]) {
        const w = weatherMood(e, o);
        expect(w.amount).toBeGreaterThanOrEqual(0.2);
        expect(w.amount).toBeLessThanOrEqual(1);
        expect(w.gust).toBeGreaterThanOrEqual(0);
        expect(w.gust).toBeLessThanOrEqual(1);
      }
  });

  it("gusts only on a hard hit", () => {
    expect(weatherMood(0.5, 0.2).gust).toBe(0);
    expect(weatherMood(0.5, 1).gust).toBe(1);
  });
});

describe("dropOpacity", () => {
  it("keeps the first drops and adds the rest as the weather gets heavier", () => {
    const at = (amount: number) => Array.from({ length: 100 }, (_, n) => dropOpacity(n, 100, amount)).reduce((a, b) => a + b);
    expect(at(1)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0.2));
    expect(dropOpacity(0, 100, 0.2)).toBe(1);
    expect(dropOpacity(99, 100, 0.2)).toBeLessThan(0.3);
  });
});
