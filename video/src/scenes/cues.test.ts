import { describe, expect, it } from "vitest";
import { cuesAt, HOLD_S, SYMBOL_S } from "./cues";

const cues = [
  { at: 10, symbol: "heart" as const },
  { at: 14, holding: "umbrella" as const },
  { at: 20, symbol: "door" as const, holding: "suitcase" as const },
];

describe("cuesAt", () => {
  it("is nothing before the first cue and with none", () => {
    expect(cuesAt(cues, 5)).toEqual({ symbol: null, holding: null });
    expect(cuesAt([], 5)).toEqual({ symbol: null, holding: null });
    expect(cuesAt(undefined, 5)).toEqual({ symbol: null, holding: null });
  });

  it("shows a symbol for a little while, with its age", () => {
    expect(cuesAt(cues, 10).symbol).toEqual({ name: "heart", age: 0 });
    expect(cuesAt(cues, 11)?.symbol?.age).toBeCloseTo(1);
    expect(cuesAt(cues, 10 + SYMBOL_S + 0.1).symbol).toBeNull();
  });

  it("keeps an item in hand until the next one is handed over, then lets go", () => {
    expect(cuesAt(cues, 15).holding).toBe("umbrella");
    expect(cuesAt(cues, 20).holding).toBe("suitcase");
    expect(cuesAt(cues, 21).symbol?.name).toBe("door");
    expect(cuesAt(cues, 20 + HOLD_S + 0.5).holding).toBeNull();
  });

  it("does not depend on the order the cues were saved in", () => {
    expect(cuesAt([...cues].reverse(), 15).holding).toBe("umbrella");
  });
});
