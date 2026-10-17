import { describe, expect, it } from "vitest";
import type { AnalysisData } from "../../shared/types";
import { beatPeriod, buildTimeline, HIT, snapCut } from "./timeline";

const FPS = 30;

/** A 40 s song at 120 BPM with downbeats every 2 s, and sections starting a little off the bar. */
function song(over: Partial<AnalysisData> = {}, rms?: (t: number) => number): AnalysisData {
  const duration = 40;
  const beats = Array.from({ length: 80 }, (_, i) => i * 0.5);
  const n = duration * FPS;
  const series = Array.from({ length: n }, (_, i) => (rms ? rms(i / FPS) : 0.5));
  return {
    duration, bpm: 120, key: "C major", beats, downbeats: beats.filter((_, i) => i % 4 === 0), onsets: [],
    sections: [{ start: 0, end: 10.2, label: "a" }, { start: 10.2, end: 19.8, label: "b" }, { start: 19.8, end: 40, label: "c" }],
    fps: FPS, rms: series, low: series, mid: series, high: series, spectral_centroid: series, onset_strength: series, chroma: [],
    ...over,
  };
}

describe("timeline", () => {
  it("measures the beat from the detected beats", () => {
    expect(beatPeriod(song())).toBeCloseTo(0.5, 9);
    expect(beatPeriod(song({ beats: [], bpm: 90 }))).toBeCloseTo(60 / 90, 9);
  });

  it("snaps each section change onto the nearest downbeat", () => {
    const tl = buildTimeline(song(), () => "crossfade");
    expect(tl.boundaries.map((b) => b.cut)).toEqual([0, 10, 20]);
  });

  it("prefers the beat a change is on over a downbeat that is a beat or more away", () => {
    expect(snapCut(song(), 11.05, 0, 20)).toBe(11);
    expect(snapCut(song(), 11.6, 0, 20)).toBe(11.5);
  });

  it("leaves a change where it is when no beat is near, and never moves it past a neighbour", () => {
    const a = song({ downbeats: [], beats: [] });
    expect(snapCut(a, 10.3, 0, 20)).toBe(10.3);
    expect(snapCut(song(), 10.2, 10.1, 20)).toBe(10.2); // the nearest beat (10) is behind the previous change
  });

  it("times each window so its hit lands on the cut, two beats long", () => {
    for (const kind of ["crossfade", "flash", "punch", "whip"] as const) {
      const b = buildTimeline(song(), () => kind).boundaries[1];
      const length = b.end - b.start;
      expect(b.start + HIT[kind] * length).toBeCloseTo(b.cut, 9);
      expect(length).toBeCloseTo(kind === "whip" ? 0.5 : 1, 9);
    }
  });

  it("shows the new section from the start of its window, while the music changes on the cut", () => {
    const tl = buildTimeline(song(), () => "crossfade");
    const b = tl.boundaries[1];
    expect(tl.sectionAt(b.start - 0.01)).toBe(0);
    expect(tl.sectionAt(b.start + 0.01)).toBe(1);
    expect(tl.musicalSectionAt(b.cut - 0.01)).toBe(0);
    expect(tl.musicalSectionAt(b.cut)).toBe(1);
    expect(tl.sectionAt(39)).toBe(2);
  });

  it("keeps windows from overlapping when sections are short", () => {
    const sections = [0, 1, 1.6, 2.4, 6].map((start, i, all) => ({ start, end: all[i + 1] ?? 10, label: `s${i}` }));
    const tl = buildTimeline(song({ sections, duration: 10, downbeats: [], beats: [] }), () => "crossfade");
    for (let i = 1; i < tl.boundaries.length; i++) {
      expect(tl.boundaries[i].start).toBeGreaterThanOrEqual(tl.boundaries[i - 1].end);
      expect(tl.boundaries[i].end).toBeGreaterThan(tl.boundaries[i].start);
    }
  });

  it("rates how hard the music hits at each cut, and notices a build before it", () => {
    // Quiet, then building over the bars before 20 s, then loud.
    const tl = buildTimeline(song({}, (t) => (t < 16 ? 0.2 : t < 20 ? 0.2 + (t - 16) * 0.12 : 0.9)), () => "flash");
    const drop = tl.boundaries[2];
    expect(drop.strength).toBeGreaterThan(0.8);
    expect(drop.build).toBeGreaterThan(0.5);
    expect(drop.buildFrom).toBeLessThan(drop.start);
    expect(tl.boundaries[1].build).toBe(0); // nothing builds into 10 s
  });

  it("alternates the direction of travel", () => {
    const dirs = buildTimeline(song(), () => "push").boundaries.slice(1).map((b) => b.dir);
    expect(dirs).toEqual([1, -1]);
  });
});
