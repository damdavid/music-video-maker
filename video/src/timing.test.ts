import { describe, expect, it } from "vitest";
import { accent, hexToHsl, hslToHex, mixPalettes, safePalette, shiftPalette } from "./color";
import { mulberry32 } from "./rng";
import { videoSize } from "./size";
import { activeLineIndex, appearTimes, beatPhase, FADES, TITLE_CAP_S, titleWindow, beatPulse, fadeEnvelope, normalizeWord, sectionIndexAt, visibleLines, wordStates } from "./timing";

const lyrics = {
  lines: [
    { start: 1, end: 3, text: "hello big world", words: [] },
    { start: 5, end: 6, text: "again", words: [{ start: 5, end: 6, text: "again" }] },
  ],
};

describe("timing", () => {
  it("finds the section containing t, clamping before the first", () => {
    const s = [{ start: 0, end: 10, label: "a" }, { start: 10, end: 20, label: "b" }];
    expect(sectionIndexAt(s, 0)).toBe(0);
    expect(sectionIndexAt(s, 9.99)).toBe(0);
    expect(sectionIndexAt(s, 10)).toBe(1);
    expect(sectionIndexAt(s, 99)).toBe(1);
  });

  it("pulses 1 on a beat and decays until the next", () => {
    const beats = [1, 2];
    expect(beatPulse(beats, 0.5)).toBe(0);
    expect(beatPulse(beats, 1)).toBeCloseTo(1);
    expect(beatPulse(beats, 1.25)).toBeCloseTo(Math.exp(-1));
    expect(beatPulse(beats, 2)).toBeCloseTo(1);
  });

  it("shows a line from before it starts until shortly after it ends", () => {
    expect(activeLineIndex(lyrics, -0.1)).toBe(-1);
    expect(activeLineIndex(lyrics, 0.1)).toBe(0); // the first line gets the long lead-in
    expect(activeLineIndex(lyrics, 3.4)).toBe(0);
    expect(activeLineIndex(lyrics, 3.6)).toBe(-1);
    expect(activeLineIndex(lyrics, 4.1)).toBe(1); // a 2 s gap before it: a second of lead-in
    expect(activeLineIndex(lyrics, 5.2)).toBe(1);
  });

  it("splits a line evenly when it has no word timings", () => {
    const w = wordStates(lyrics.lines[0], 2);
    expect(w.map((x) => x.text)).toEqual(["hello", "big", "world"]);
    expect(w[0].progress).toBe(1);
    expect(w[1].progress).toBeCloseTo(0.5);
    expect(w[2].progress).toBe(0);
  });

  it("uses real word timings when present", () => {
    expect(wordStates(lyrics.lines[1], 5.5)[0].progress).toBeCloseTo(0.5);
  });

  it("normalizes words for emphasis matching", () => {
    expect(normalizeWord("Home,")).toBe("home");
    expect(normalizeWord("don't!")).toBe("don't");
  });

  it("fades in and out at the edges", () => {
    expect(fadeEnvelope(0, 0, 10)).toBe(0);
    expect(fadeEnvelope(5, 0, 10)).toBe(1);
    expect(fadeEnvelope(10, 0, 10)).toBe(0);
  });
});

describe("rng", () => {
  it("is deterministic per seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("color", () => {
  it("shifts hue warmer or cooler and leaves greys alone", () => {
    const [warm] = shiftPalette(["#3050c0"], 1);
    expect(warm).toMatch(/^#[0-9a-f]{6}$/); // must stay hex: presets re-parse it
    expect(hexToHsl(warm).h).toBeGreaterThan(hexToHsl("#3050c0").h); // blue goes toward warm via purple (shorter arc)
    const [cool] = shiftPalette(["#c05030"], -1);
    expect(hexToHsl(cool).h).toBeGreaterThan(hexToHsl("#c05030").h);
    expect(shiftPalette(["#808080"], 1)).toEqual(["#808080"]);
    expect(shiftPalette(["#3050c0"], 0)[0].toLowerCase()).toBe("#3050c0");
  });

  it("round-trips hex through HSL", () => {
    for (const hex of ["#3050c0", "#c06c84", "#0b1020", "#f8e9d2"]) expect(hslToHex(hexToHsl(hex))).toBe(hex);
  });

  it("picks accents between the darkest and lightest swatch", () => {
    expect(accent(["#000", "#a", "#b", "#fff"], 0)).toBe("#a");
    expect(accent(["#000", "#a", "#b", "#fff"], 3)).toBe("#b");
    expect(accent(["#000", "#fff"], 0)).toBe("#fff");
  });
});

describe("videoSize", () => {
  it("derives dimensions from aspect and resolution", () => {
    expect(videoSize({ aspect: "16:9", resolution: "1080p" })).toEqual({ width: 1920, height: 1080 });
    expect(videoSize({ aspect: "9:16", resolution: "1080p" })).toEqual({ width: 1080, height: 1920 });
    expect(videoSize({ aspect: "1:1", resolution: "720p" })).toEqual({ width: 720, height: 720 });
    expect(videoSize({ aspect: "16:9", resolution: "720p" })).toEqual({ width: 1280, height: 720 });
  });
});

describe("beatPhase", () => {
  it("counts beats along the detected beats, landing on integers exactly on them", () => {
    const beats = [1, 1.5, 2.2, 2.6];
    expect(beatPhase(beats, 1, 120)).toBe(0);
    expect(beatPhase(beats, 1.25, 120)).toBeCloseTo(0.5, 9);
    expect(beatPhase(beats, 2.2, 120)).toBe(2);
    expect(beatPhase(beats, 1.85, 120)).toBeCloseTo(1.5, 9); // halfway through a longer gap
  });

  it("carries on at the tempo before the first and after the last beat, and with no beats at all", () => {
    expect(beatPhase([1, 1.5], 0.5, 120)).toBeCloseTo(-1, 9);
    expect(beatPhase([1, 1.5], 2.5, 120)).toBeCloseTo(3, 9);
    expect(beatPhase([], 3, 120)).toBeCloseTo(6, 9);
    expect(Number.isFinite(beatPhase([], 3, 0))).toBe(true);
  });
});

describe("visibleLines", () => {
  const backToBack = { lines: [{ start: 10, end: 12, text: "first line" }, { start: 12, end: 14, text: "second line" }] };

  it("never blinks out when one line follows straight on from another", () => {
    for (let t = 10.2; t < 13.5; t += 0.01) {
      const shown = visibleLines(backToBack, t);
      expect(Math.max(...shown.map((l) => l.opacity))).toBeGreaterThan(0.45);
    }
  });

  it("lets the outgoing line clear briefly while lifting it away, then shows only the new one", () => {
    const handover = visibleLines(backToBack, 11.9);
    expect(handover.map((l) => l.index)).toEqual([0, 1]);
    expect(handover[0].exit).toBeGreaterThan(0);
    expect(visibleLines(backToBack, 12.2).map((l) => l.index)).toEqual([1]);
  });

  it("fades a lone line in before it starts and out after it ends, like activeLineIndex", () => {
    expect(visibleLines(lyrics, -0.1)).toEqual([]);
    expect(visibleLines(lyrics, 0.1)[0].index).toBe(0);
    expect(visibleLines(lyrics, 2)[0].opacity).toBe(1);
    expect(visibleLines(lyrics, 3.5)).toEqual([]);
  });

  describe("lead-in", () => {
    const at = (lines: { start: number; end: number }[]) => appearTimes({ lines: lines.map((l) => ({ ...l, text: "x" })) });

    it("is a second after a gap of two seconds or more, and for the first line", () => {
      expect(at([{ start: 10, end: 12 }, { start: 20, end: 22 }])).toEqual([9, 19]);
    });

    it("is half a second after a shorter gap", () => {
      expect(at([{ start: 10, end: 12 }, { start: 14, end: 16 }, { start: 16.8, end: 18 }])).toEqual([9, 13, 16.3]);
    });

    it("never starts before the previous line has ended, so it is never pushed out mid-line", () => {
      const times = at([{ start: 10, end: 12 }, { start: 12.3, end: 14 }]);
      expect(times[1]).toBeCloseTo(12, 9);
      const board = { lines: [{ start: 10, end: 12, text: "a" }, { start: 12.3, end: 14, text: "b" }] };
      expect(visibleLines(board, 11.99).map((l) => [l.index, l.exit])).toEqual([[0, 0]]);
    });

    it("keeps the short lead-in when lines run straight on, and stays in order for overlapping lines", () => {
      expect(at([{ start: 10, end: 12 }, { start: 12, end: 14 }])[1]).toBeCloseTo(11.85, 9);
      const overlapping = at([{ start: 10, end: 12 }, { start: 10.05, end: 14 }, { start: 11, end: 15 }]);
      expect(overlapping).toEqual([...overlapping].sort((a, b) => a - b));
    });

    it("has the line fully readable before its first word is sung, however much room there was", () => {
      const lone = { lines: [{ start: 20, end: 22, text: "x" }, { start: 30, end: 32, text: "y" }] };
      expect(visibleLines(lone, 29.05)[0]).toMatchObject({ index: 1 });
      expect(visibleLines(lone, 29.2)[0].opacity).toBeLessThan(1);
      expect(visibleLines(lone, 29.3)[0].opacity).toBe(1);
      const tight = { lines: [{ start: 10, end: 12, text: "a" }, { start: 12, end: 14, text: "b" }] };
      expect(visibleLines(tight, 12)[1].opacity).toBe(1);
    });
  });

  it("keeps a line that clears itself (dotDissolve) opaque after it ends, until the hold is over", () => {
    expect(visibleLines(lyrics, 3.45, () => false)[0].opacity).toBe(1);
    expect(visibleLines(lyrics, 3.6, () => false)).toEqual([]);
  });
});

describe("palettes", () => {
  const fallback = ["#000000", "#ffffff"];

  it("keeps a palette with at least two valid colours and replaces anything less", () => {
    expect(safePalette(["#112233", "#445566"], fallback)).toEqual(["#112233", "#445566"]);
    expect(safePalette(["#112233", "nope", "#445566"], fallback)).toEqual(["#112233", "#445566"]);
    expect(safePalette(["#112233"], fallback)).toBe(fallback);
    expect(safePalette([], fallback)).toBe(fallback);
    expect(safePalette(null, fallback)).toBe(fallback);
  });

  it("blends palettes swatch by swatch, matching different lengths by position", () => {
    expect(mixPalettes(["#000000", "#ffffff"], ["#ff0000", "#00ff00"], 0)).toEqual(["#000000", "#ffffff"]);
    expect(mixPalettes(["#000000", "#ffffff"], ["#ff0000", "#00ff00"], 1)).toEqual(["#ff0000", "#00ff00"]);
    expect(mixPalettes(["#000000", "#ffffff"], ["#000000", "#808080", "#ffffff"], 0.5)).toEqual(["#000000", "#808080", "#ffffff"]);
  });
});

describe("lyric fade presets", () => {
  const board = { lines: [{ start: 10, end: 12, text: "first line" }, { start: 12, end: 14, text: "second line" }] };
  // The second line takes over at 11.85 (a 0.15 s lead-in); how far the first has cleared a little after.
  const cleared = (fade: "hard" | "normal" | "gentle", dt: number) => visibleLines(board, 11.85 + dt, () => true, fade).find((l) => l.index === 0)?.exit ?? 1;

  it("gets slower from hard to gentle", () => {
    expect(FADES.hard.handoff).toBeLessThan(FADES.normal.handoff);
    expect(FADES.normal.handoff).toBeLessThan(FADES.gentle.handoff);
    expect(cleared("hard", 0.1)).toBeCloseTo(1, 6);
    expect(cleared("normal", 0.1)).toBeGreaterThan(0.4);
    expect(cleared("gentle", 0.1)).toBeLessThan(0.3);
  });

  it("always finishes clearing the old line, and never flickers the new one out", () => {
    for (const fade of ["hard", "normal", "gentle"] as const) {
      expect(cleared(fade, 0.6)).toBeCloseTo(1, 6);
      for (let t = 10.2; t < 13.5; t += 0.01) expect(Math.max(...visibleLines(board, t, () => true, fade).map((l) => l.opacity))).toBeGreaterThan(0.2);
    }
  });

  it("lets a gentle line linger longer after it ends when nothing follows", () => {
    const lone = { lines: [{ start: 10, end: 12, text: "x" }] };
    const at = (fade: "hard" | "normal" | "gentle") => visibleLines(lone, 12.5, () => true, fade)[0]?.opacity ?? 0;
    expect(at("hard")).toBe(0);
    expect(at("gentle")).toBeGreaterThan(at("normal"));
  });
});

describe("titleWindow", () => {
  const at = (start: number) => ({ lines: [{ start, end: start + 3, text: "x" }] });

  it("holds through the intro and is gone just before the first line appears", () => {
    // A line at 6 s first appears at 5 s (a second of lead-in after the start of the song), so the card leaves by 4.9.
    expect(titleWindow(at(6))).toBeCloseTo(appearTimes(at(6))[0] - 0.1, 9);
    expect(titleWindow(at(6))).toBeLessThan(appearTimes(at(6))[0]);
  });

  it("is capped when the intro is long", () => {
    expect(titleWindow(at(60))).toBe(TITLE_CAP_S);
  });

  it("is skipped when the lyrics start too soon for it to fit", () => {
    expect(titleWindow(at(1))).toBe(0);
    expect(titleWindow(at(2))).toBe(0);
  });

  it("takes the cap when there are no lyrics to wait for", () => {
    expect(titleWindow(null)).toBe(TITLE_CAP_S);
    expect(titleWindow({ lines: [] })).toBe(TITLE_CAP_S);
  });
});
