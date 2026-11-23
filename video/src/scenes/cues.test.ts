import { describe, expect, it } from "vitest";
import { cuesAt, HOLD_S, SYMBOL_S } from "./cues";

const cues = [
  { at: 10, symbol: "heart" as const },
  { at: 14, holding: "umbrella" as const },
  { at: 20, symbol: "door" as const, holding: "suitcase" as const },
];

describe("cuesAt", () => {
  it("is nothing before the first cue and with none", () => {
    expect(cuesAt(cues, 5)).toEqual({ symbol: null, holding: null, holdAge: null });
    expect(cuesAt([], 5)).toEqual({ symbol: null, holding: null, holdAge: null });
    expect(cuesAt(undefined, 5)).toEqual({ symbol: null, holding: null, holdAge: null });
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

describe("cueTint", () => {
  it("is nothing without a cue, and rises and falls with a symbol", async () => {
    const { cueTint, SYMBOL_COLOR } = await import("./cues");
    expect(cueTint(cuesAt([], 5))).toBeNull();
    const at = (t: number) => cueTint(cuesAt([{ at: 10, symbol: "heart" as const }], t));
    expect(at(9)).toBeNull();
    expect(at(10)).toBeNull(); // just starting
    const mid = at(11)!;
    expect(mid.color).toBe(SYMBOL_COLOR.heart);
    expect(mid.amount).toBeGreaterThan(0.4);
    expect(at(10 + SYMBOL_S - 0.1)!.amount).toBeLessThan(mid.amount);
    expect(at(10 + SYMBOL_S + 0.1)).toBeNull();
  });

  it("tints gently for an item in hand, and lets the symbol win while it is up", async () => {
    const { cueTint, HELD_COLOR } = await import("./cues");
    const cues = [{ at: 10, holding: "lantern" as const }, { at: 14, symbol: "moon" as const }];
    const held = cueTint(cuesAt(cues, 12))!;
    expect(held.color).toBe(HELD_COLOR.lantern);
    expect(held.amount).toBeLessThan(0.35);
    expect(cueTint(cuesAt(cues, 15))!.color).not.toBe(HELD_COLOR.lantern);
    expect(cueTint(cuesAt(cues, 10 + HOLD_S + 1))).toBeNull();
  });
});
