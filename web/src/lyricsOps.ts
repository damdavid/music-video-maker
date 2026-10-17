import type { Line, Lyrics } from "../../shared/types";

const round = (t: number) => Math.round(Math.max(t, 0) * 1000) / 1000;

/** Moves/rescales a line to [start, end], scaling its word times proportionally. */
export function setLineTimes(line: Line, start: number, end: number): Line {
  const s = round(start);
  const e = round(Math.max(end, s + 0.05));
  const span = line.end - line.start;
  const k = span > 0 ? (e - s) / span : 1;
  return {
    ...line,
    start: s,
    end: e,
    words: line.words?.map((w) => ({
      ...w,
      start: round(s + (w.start - line.start) * k),
      end: round(s + (w.end - line.start) * k),
    })),
  };
}

export function updateLine(lyrics: Lyrics, i: number, line: Line): Lyrics {
  return { lines: lyrics.lines.map((l, j) => (j === i ? line : l)) };
}

/** Tap-to-sync: line i starts at t, keeping its duration and trimming the previous line to t. */
export function tapLine(lyrics: Lyrics, i: number, t: number): Lyrics {
  const line = lyrics.lines[i];
  const moved = setLineTimes(line, t, t + (line.end - line.start));
  const lines = lyrics.lines.map((l, j) => (j === i ? moved : l));
  const prev = lines[i - 1];
  if (prev && prev.end > moved.start) lines[i - 1] = setLineTimes(prev, prev.start, moved.start);
  return { lines };
}

export function nudge(line: Line, deltaStart: number, deltaEnd: number): Line {
  return setLineTimes(line, line.start + deltaStart, line.end + deltaEnd);
}
