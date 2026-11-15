import { describe, expect, it } from "vitest";
import type { Lyrics } from "../../../shared/types";
import { mouthOpen } from "./lip";

const lyrics: Lyrics = {
  lines: [
    { start: 1, end: 3, text: "hello world", words: [{ start: 1, end: 2, text: "hello" }, { start: 2.5, end: 3, text: "world" }] },
    { start: 5, end: 6, text: "plain" },
  ],
};

describe("mouthOpen", () => {
  it("is closed with no lyrics and outside lines", () => {
    expect(mouthOpen(null, 1.5)).toBe(0);
    expect(mouthOpen(lyrics, 0.2)).toBe(0);
    expect(mouthOpen(lyrics, 4)).toBe(0);
  });

  it("opens mid-word and closes at the word's edges", () => {
    expect(mouthOpen(lyrics, 1.5)).toBeGreaterThan(0.5);
    expect(mouthOpen(lyrics, 1.001)).toBeLessThan(0.2);
  });

  it("stays nearly closed in the gap between words", () => {
    expect(mouthOpen(lyrics, 2.25)).toBeLessThan(0.2);
  });

  it("moves through a line that has no word times", () => {
    const samples = Array.from({ length: 20 }, (_, i) => mouthOpen(lyrics, 5 + i * 0.045));
    expect(Math.max(...samples)).toBeGreaterThan(0.5);
    expect(Math.min(...samples)).toBeLessThan(0.2);
  });
});
