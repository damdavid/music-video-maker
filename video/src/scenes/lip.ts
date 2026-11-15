import type { Lyrics } from "../../../shared/types";
import { activeLineIndex } from "../timing";

const SYLLABLES_PER_SECOND = 5;

/** How far a singer's mouth is open (0..1) at time t: it opens and closes through each aligned word and rests between lines. */
export function mouthOpen(lyrics: Lyrics | null, t: number): number {
  if (!lyrics) return 0;
  const line = lyrics.lines[activeLineIndex(lyrics, t)];
  if (!line || t < line.start || t > line.end) return 0;
  const word = line.words?.find((w) => t >= w.start && t <= w.end);
  if (word) {
    const p = (t - word.start) / Math.max(word.end - word.start, 1e-3);
    // A long held word wobbles instead of freezing open.
    return Math.sin(Math.PI * p) ** 0.6 * (0.8 + 0.2 * Math.sin(2 * Math.PI * 4 * t));
  }
  // Without word times, the mouth just keeps working through the line.
  return line.words?.length ? 0.1 : Math.abs(Math.sin(Math.PI * SYLLABLES_PER_SECOND * (t - line.start))) * 0.8;
}
