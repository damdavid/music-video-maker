import type { Storyboard } from "../../../shared/types";
import type { Mood } from "./face";

/** A mood set on a lyric line colours the lead's face for this long at most, then the scene's own expression returns. */
export const MOOD_HOLD_S = 8;

/** The expression the lyrics call for at time t: the latest mood set at or before t, while it still holds. */
export function moodAt(moods: Storyboard["moods"], t: number): Mood | null {
  let found: { at: number; expression: Mood } | null = null;
  for (const m of moods ?? []) if (m.at <= t && (!found || m.at > found.at)) found = { at: m.at, expression: m.expression };
  return found && t - found.at <= MOOD_HOLD_S ? found.expression : null;
}

/**
 * How strongly a face shows its expression: the music's loudness scales it, so a feeling reads bigger in a loud
 * passage and softer in a quiet one (0.7 to 1.25).
 */
export const expressionStrength = (energy: number) => 0.7 + 0.55 * Math.max(0, Math.min(1, energy));
