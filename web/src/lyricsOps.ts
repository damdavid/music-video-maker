import type { Line, Lyrics } from "../../shared/types";

const round = (t: number) => Math.round(Math.max(t, 0) * 1000) / 1000;
const MIN_LINE_S = 0.05;

/** A line's bounds are the extent of its words: the video shows a line from its start to its end, so a word outside them would never be seen. */
export function withBounds(line: Line): Line {
  const words = line.words ?? [];
  if (!words.length) return line;
  return { ...line, start: Math.min(...words.map((w) => w.start)), end: Math.max(...words.map((w) => w.end)) };
}

/**
 * Moves/rescales a line to [start, end], scaling its word times proportionally. The scale comes from the words' own
 * extent, not the line's stored span, so a line whose span had gone stale can't multiply its words by a huge factor.
 */
export function setLineTimes(line: Line, start: number, end: number): Line {
  const s = round(start);
  const e = round(Math.max(end, s + MIN_LINE_S));
  const words = line.words ?? [];
  if (!words.length) return { ...line, start: s, end: e };
  const first = Math.min(...words.map((w) => w.start));
  const extent = Math.max(...words.map((w) => w.end)) - first;
  const n = words.length;
  const moved = words.map((w, i) =>
    // Words with no extent between them (all collapsed) are spread evenly instead.
    extent > 1e-3
      ? { ...w, start: round(s + ((w.start - first) * (e - s)) / extent), end: round(s + ((w.end - first) * (e - s)) / extent) }
      : { ...w, start: round(s + (i * (e - s)) / n), end: round(s + ((i + 1) * (e - s)) / n) },
  );
  return withBounds({ ...line, words: moved });
}

/** Moves one word's start (its end stays unless it would be before the start), and the line's bounds follow. */
export function setWordStart(line: Line, index: number, start: number): Line {
  const s = round(start);
  return withBounds({ ...line, words: line.words?.map((w, i) => (i === index ? { ...w, start: s, end: Math.max(w.end, s + 0.02) } : w)) });
}

export function updateLine(lyrics: Lyrics, i: number, line: Line): Lyrics {
  return { lines: lyrics.lines.map((l, j) => (j === i ? line : l)) };
}

/** Cuts a line off at t, leaving the times of the words before it alone (rescaling them would squash the whole line). */
export function trimLineTo(line: Line, t: number): Line {
  if (!line.words?.length) return { ...line, end: Math.min(line.end, Math.max(t, line.start)) };
  const cut = Math.max(t, line.start);
  return withBounds({ ...line, words: line.words.map((w) => ({ ...w, start: Math.min(w.start, cut), end: Math.min(w.end, cut) })) });
}

/** Tap-to-sync: line i starts at t, keeping its duration and trimming the previous line to t. */
export function tapLine(lyrics: Lyrics, i: number, t: number): Lyrics {
  const line = lyrics.lines[i];
  const moved = setLineTimes(line, t, t + (line.end - line.start));
  const lines = lyrics.lines.map((l, j) => (j === i ? moved : l));
  const prev = lines[i - 1];
  if (prev && prev.end > moved.start) lines[i - 1] = trimLineTo(prev, moved.start);
  return { lines };
}

export function nudge(line: Line, deltaStart: number, deltaEnd: number): Line {
  return setLineTimes(line, line.start + deltaStart, line.end + deltaEnd);
}
