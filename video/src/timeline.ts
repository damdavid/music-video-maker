import type { AnalysisData, TransitionIn as Transition } from "../../shared/types";
import { clamp, lastStartedIndex } from "./timing";

/** Where in its window each transition lands its hit (the cut, the flash peak, the mask closing), 0..1. */
export const HIT: Record<Transition, number> = {
  crossfade: 0.5,
  flash: 0,
  zoomThrough: 0.5,
  iris: 0.2,
  dive: 0.2,
  push: 0.5,
  whip: 0.5,
  wipe: 0.5,
  punch: 0.55,
};

/** Transition length in beats; quick moves (whip) are shorter so they read as one gesture. */
const BEATS: Record<Transition, number> = { crossfade: 2, flash: 2, zoomThrough: 2, iris: 2, dive: 2, push: 1.5, whip: 1, wipe: 1.5, punch: 2 };
const MIN_S = 0.45;
const MAX_S = 1.6;
/** Share of the gap between neighbouring cuts a transition may take on each side, so windows never overlap. */
const MAX_GAP_SHARE = 0.45;
const FALLBACK_BPM = 100;

export type Boundary = {
  /** Window in seconds; the incoming section is drawn from `start`, the outgoing one until `end`. */
  start: number;
  end: number;
  /** The beat the transition hits on: the section's start snapped to the nearest downbeat. */
  cut: number;
  kind: Transition;
  /** +1 or -1: which way push, whip and wipe travel; alternates so consecutive moves don't all go the same way. */
  dir: number;
  /** 0..1, how much louder the music gets across the cut; scales flashes and punches. */
  strength: number;
  /** A swell into the transition when the music builds before it (0 = none), ramping in from `buildFrom`. */
  build: number;
  buildFrom: number;
};

export type Timeline = {
  /** Index i describes the change into section i; index 0 is a placeholder with an empty window at 0. */
  boundaries: Boundary[];
  /** Section shown at t (switches at the start of each transition window). */
  sectionAt: (t: number) => number;
  /** Section the music is in at t (switches on the cut); use for anything tied to the song, like lyrics. */
  musicalSectionAt: (t: number) => number;
};

const periods = new WeakMap<number[], number>();

/** Typical seconds per beat: the median gap between detected beats, else from the tempo. */
export function beatPeriod(a: AnalysisData): number {
  const cached = periods.get(a.beats);
  if (cached !== undefined) return cached;
  let period = 60 / (a.bpm || FALLBACK_BPM);
  if (a.beats.length >= 2) {
    const gaps = a.beats.slice(1).map((b, i) => b - a.beats[i]).sort((x, y) => x - y);
    period = gaps[gaps.length >> 1];
  }
  periods.set(a.beats, period);
  return period;
}

function nearest(sorted: number[], t: number): number | null {
  const i = lastStartedIndex(sorted, t);
  const cands = [sorted[i], sorted[i + 1]].filter((x): x is number => x !== undefined);
  if (!cands.length) return null;
  return cands.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best));
}

/**
 * The section start moved onto the nearest downbeat, else beat, when one is close; never past its neighbours.
 * Downbeats are only estimated (every 4th beat from the first), so a change is never dragged far to reach one.
 */
export function snapCut(a: AnalysisData, start: number, lo: number, hi: number): number {
  const beat = beatPeriod(a);
  const down = nearest(a.downbeats, start);
  if (down !== null && Math.abs(down - start) <= beat * 0.6 && down > lo && down < hi) return down;
  const b = nearest(a.beats, start);
  if (b !== null && Math.abs(b - start) <= beat / 2 && b > lo && b < hi) return b;
  return start;
}

const meanRms = (a: AnalysisData, from: number, to: number) => {
  const fps = a.fps ?? 30;
  const i0 = Math.max(0, Math.floor(from * fps));
  const i1 = Math.min(a.rms.length, Math.max(i0 + 1, Math.ceil(to * fps)));
  let s = 0;
  for (let i = i0; i < i1; i++) s += a.rms[i];
  return i1 > i0 ? s / (i1 - i0) : 0;
};

export function buildTimeline(a: AnalysisData, kindOf: (section: number) => Transition): Timeline {
  const sections = a.sections;
  const beat = beatPeriod(a);
  const bar = beat * 4;
  const cuts: number[] = [];
  sections.forEach((s, i) => {
    if (i === 0) return void cuts.push(0);
    const next = sections[i + 1]?.start ?? a.duration;
    cuts.push(snapCut(a, s.start, Math.max(cuts[i - 1], sections[i - 1].start) + 0.1, next - 0.1));
  });

  const boundaries: Boundary[] = cuts.map((cut, i) => {
    if (i === 0) return { start: 0, end: 0, cut: 0, kind: "crossfade", dir: 1, strength: 0, build: 0, buildFrom: 0 };
    const kind = kindOf(i);
    const prevGap = cut - cuts[i - 1];
    const nextGap = (cuts[i + 1] ?? a.duration) - cut;
    const length = Math.min(clamp(BEATS[kind] * beat, MIN_S, MAX_S), MAX_GAP_SHARE * prevGap, MAX_GAP_SHARE * nextGap);
    const start = cut - HIT[kind] * length;
    const before = meanRms(a, cut - bar, cut);
    const after = meanRms(a, cut, cut + bar);
    const rise = before - meanRms(a, cut - 2 * bar, cut - bar);
    const build = clamp((rise - 0.04) * 6);
    return {
      start,
      end: start + length,
      cut,
      kind,
      dir: i % 2 ? 1 : -1,
      strength: clamp(0.5 + 2.5 * (after - before)),
      build,
      buildFrom: Math.max(cuts[i - 1], start - bar),
    };
  });

  const starts = boundaries.map((b) => b.start);
  return {
    boundaries,
    sectionAt: (t) => Math.max(0, lastStartedIndex(starts, t)),
    musicalSectionAt: (t) => Math.max(0, lastStartedIndex(cuts, t)),
  };
}
