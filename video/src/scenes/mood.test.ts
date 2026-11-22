import { describe, expect, it } from "vitest";
import { expressionStrength, MOOD_HOLD_S, moodAt } from "./mood";

const moods = [
  { at: 10, expression: "sad" as const },
  { at: 20, expression: "determined" as const },
];

describe("moodAt", () => {
  it("is nothing before the first mood and when there are none", () => {
    expect(moodAt(moods, 5)).toBeNull();
    expect(moodAt([], 5)).toBeNull();
    expect(moodAt(undefined, 5)).toBeNull();
  });

  it("holds the latest mood until the next one", () => {
    expect(moodAt(moods, 10)).toBe("sad");
    expect(moodAt(moods, 15)).toBe("sad");
    expect(moodAt(moods, 20)).toBe("determined");
  });

  it("lets go after a while so the scene's own expression comes back", () => {
    expect(moodAt(moods, 10 + MOOD_HOLD_S)).toBe("sad");
    expect(moodAt(moods, 10 + MOOD_HOLD_S + 0.5)).toBeNull();
  });

  it("does not depend on the order the moods were saved in", () => {
    expect(moodAt([...moods].reverse(), 25)).toBe("determined");
  });
});

describe("expressionStrength", () => {
  it("grows with loudness and stays in range", () => {
    expect(expressionStrength(0)).toBeCloseTo(0.7);
    expect(expressionStrength(1)).toBeCloseTo(1.25);
    expect(expressionStrength(0.2)).toBeLessThan(expressionStrength(0.8));
    expect(expressionStrength(5)).toBeCloseTo(1.25);
  });
});
