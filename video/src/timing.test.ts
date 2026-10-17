import { describe, expect, it } from "vitest";
import { accent, hexToHsl, hslToHex, mixPalettes, safePalette, shiftPalette } from "./color";
import { mulberry32 } from "./rng";
import { videoSize } from "./size";
import { activeLineIndex, beatPhase, beatPulse, fadeEnvelope, normalizeWord, sectionIndexAt, visibleLines, wordStates } from "./timing";

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

  it("shows a line from just before it starts until shortly after it ends", () => {
    expect(activeLineIndex(lyrics, 0.5)).toBe(-1);
    expect(activeLineIndex(lyrics, 0.9)).toBe(0);
    expect(activeLineIndex(lyrics, 3.4)).toBe(0);
    expect(activeLineIndex(lyrics, 4)).toBe(-1);
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
    expect(visibleLines(lyrics, 0.5)).toEqual([]);
    expect(visibleLines(lyrics, 0.9)[0].index).toBe(0);
    expect(visibleLines(lyrics, 2)[0].opacity).toBe(1);
    expect(visibleLines(lyrics, 3.5)).toEqual([]);
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
