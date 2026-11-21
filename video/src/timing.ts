import type { Line, Lyrics, Section } from "../../shared/types";

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** Index of the last item whose value is <= t (binary search over a sorted array); -1 if t precedes all. */
export function lastStartedIndex(starts: number[], t: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function sectionIndexAt(sections: Section[], t: number): number {
  return Math.max(0, lastStartedIndex(sections.map((s) => s.start), t));
}

/** 1 right on a beat, decaying exponentially until the next one. */
export function beatPulse(beats: number[], t: number, decay = 0.25): number {
  const i = lastStartedIndex(beats, t);
  return i < 0 ? 0 : Math.exp(-(t - beats[i]) / decay);
}

/**
 * Beats elapsed at time t, following the detected beats rather than a fixed tempo, so moves stay on the beat when the
 * tempo drifts. Integer values land exactly on beats; before the first and after the last it continues at `bpm`.
 */
export function beatPhase(beats: number[], t: number, bpm: number): number {
  const period = 60 / Math.max(bpm || 100, 30);
  if (beats.length === 0) return t / period;
  const i = lastStartedIndex(beats, t);
  if (i < 0) return (t - beats[0]) / period;
  if (i >= beats.length - 1) return i + (t - beats[i]) / period;
  return i + (t - beats[i]) / Math.max(beats[i + 1] - beats[i], 1e-3);
}

/** How early a line starts to appear: this at least, so lines that run on from one another still show in time. */
const MIN_LEAD = 0.15;
/** The usual lead-in, enough for the line to be fully readable when its first word is sung. */
const LEAD = 0.5;
/** A line after a gap of at least LONG_GAP seconds (a break, or the start of the song) gets the longer lead-in. */
const LONG_LEAD = 1;
const LONG_GAP = 2;
const HOLD_AFTER = 0.5;
const FADE_IN = 0.25;
/** The text (and scrim) of a line is gone this long after the line ends. */
const LINGER = 0.4;
/** How quickly a line clears when the next one takes over before it has faded on its own. */
const HANDOFF = 0.22;

const appearCache = new WeakMap<Lyrics, number[]>();

/**
 * When each line starts to appear: a little before it is sung, so there is time to read it. The lead-in is never longer
 * than the time since the previous line ended, so a line is never pushed off screen while it is still being sung.
 */
export function appearTimes(lyrics: Lyrics): number[] {
  const cached = appearCache.get(lyrics);
  if (cached) return cached;
  let prevEnd = Number.NEGATIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  const times = lyrics.lines.map((l) => {
    const room = l.start - prevEnd;
    const lead = room >= LONG_GAP ? LONG_LEAD : Math.min(LEAD, Math.max(room, MIN_LEAD));
    last = Math.max(l.start - lead, last); // lastStartedIndex needs them in order
    prevEnd = l.end;
    return last;
  });
  appearCache.set(lyrics, times);
  return times;
}

/** The line to show at time t, lingering briefly after it ends; -1 when between lines. */
export function activeLineIndex(lyrics: Lyrics, t: number): number {
  const i = lastStartedIndex(appearTimes(lyrics), t);
  if (i < 0) return -1;
  return t <= lyrics.lines[i].end + HOLD_AFTER ? i : -1;
}

/** How the title card is timed before the lyrics: it holds up to this long, and is gone before the first line appears. */
export const TITLE_CAP_S = 8;
const TITLE_MIN_S = 1.5;
/** Seconds the title card shows at the start of a lyric video: the intro, up to the cap; 0 when the lyrics start too soon to fit it. */
export function titleWindow(lyrics: Lyrics | null): number {
  const first = lyrics?.lines.length ? appearTimes(lyrics)[0] : Number.POSITIVE_INFINITY;
  const room = Math.min(TITLE_CAP_S, first - 0.1);
  return room >= TITLE_MIN_S ? room : 0;
}

export type VisibleLine = {
  index: number;
  /** 0..1 fade of the whole line. */
  opacity: number;
  /** 0 while the line is current, rising to 1 as the next line pushes it out. */
  exit: number;
};

/**
 * The lines on screen at t: the current one and, while it hands over, the previous one leaving. A line cut short by the
 * next one clears over HANDOFF instead of vanishing, so back-to-back lines never blink. `fadesOut: false` keeps a line
 * fully opaque after it ends (for animations that clear the text themselves).
 */
export function visibleLines(lyrics: Lyrics, t: number, fadesOut: (index: number) => boolean = () => true): VisibleLine[] {
  const lines = lyrics.lines;
  const appear = appearTimes(lyrics);
  const i = lastStartedIndex(appear, t);
  if (i < 0) return [];
  const out: VisibleLine[] = [];
  const shown = (k: number): VisibleLine | null => {
    const line = lines[k];
    const from = appear[k];
    const takeover = appear[k + 1] ?? Number.POSITIVE_INFINITY;
    // Fully in by the time the line is sung, even when there was little room to lead in.
    const fadeIn = clamp((t - from) / Math.max(Math.min(FADE_IN, line.start - from), 0.05));
    const own = fadesOut(k) ? clamp((line.end + LINGER - t) / FADE_IN) : t <= line.end + HOLD_AFTER ? 1 : 0;
    const exit = t >= takeover ? clamp((t - takeover) / HANDOFF) : 0;
    const opacity = Math.min(fadeIn, own, 1 - exit);
    return opacity > 0 ? { index: k, opacity, exit } : null;
  };
  const prev = i > 0 ? shown(i - 1) : null;
  if (prev) out.push(prev);
  const cur = shown(i);
  if (cur) out.push(cur);
  return out;
}

export type WordState = { text: string; start: number; end: number; progress: number };

/** Per-word progress (0 unsung .. 1 sung). Falls back to splitting the line evenly when it has no word timings. */
export function wordStates(line: Line, t: number): WordState[] {
  const words = line.words?.length
    ? line.words.map((w) => ({ text: w.text, start: w.start, end: w.end }))
    : (() => {
        const parts = line.text.split(/\s+/).filter(Boolean);
        const step = (line.end - line.start) / Math.max(parts.length, 1);
        return parts.map((text, i) => ({ text, start: line.start + i * step, end: line.start + (i + 1) * step }));
      })();
  return words.map((w) => ({ ...w, progress: clamp((t - w.start) / Math.max(w.end - w.start, 0.001)) }));
}

export const normalizeWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

export function fadeEnvelope(t: number, start: number, end: number, fade = 0.3): number {
  return clamp(Math.min((t - start) / fade, (end - t) / fade));
}
