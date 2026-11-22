import { mix } from "../color";
import { clamp } from "../timing";
import type { TimeOfDay } from "../../../shared/types";
import { sceneColors, type SceneColors } from "./sky";

const ORDER: TimeOfDay[] = ["dawn", "day", "dusk", "night"];
/** How far a scene's light travels toward the next time of day by the end of its section (0 = not at all, 1 = all the way). */
export const DRIFT = 0.35;

const smooth = (x: number) => {
  const p = clamp(x);
  return p * p * (3 - 2 * p);
};

/** The colours of a scene `progress` (0..1) of the way through its section: the light slowly moving on toward the next time of day. */
export function driftColors(palette: string[], time: TimeOfDay, progress: number): SceneColors {
  const now = sceneColors(palette, time);
  const k = DRIFT * smooth(progress);
  if (k <= 0) return now;
  const next = sceneColors(palette, ORDER[(ORDER.indexOf(time) + 1) % ORDER.length]);
  const blend = (key: Exclude<keyof SceneColors, "time">) => mix(now[key], next[key], k);
  // The structure (stars, moon or sun) stays the scene's own; only the colours move.
  return {
    ...now,
    skyTop: blend("skyTop"),
    skyBottom: blend("skyBottom"),
    far: blend("far"),
    mid: blend("mid"),
    near: blend("near"),
    ground: blend("ground"),
    light: blend("light"),
    celestial: blend("celestial"),
    ink: blend("ink"),
  };
}

/** How much the light shows against each time of day: a rim or a flare reads in the dark and washes out in daylight. */
export const SHOWS: Record<TimeOfDay, number> = { dawn: 0.75, day: 0.35, dusk: 0.95, night: 1 };

export type Lighting = {
  /** 0..~0.1: a brief lift of the whole scene's light on a beat, bigger on a downbeat. */
  flash: number;
  /** 0..1: a lens flare at the sun or moon when something loud hits. */
  flare: number;
  /** 0..0.7: the strength of the light that edges the characters. */
  rim: number;
};

/**
 * The light the music adds at one moment. `beat` and `down` are beat envelopes (1 right on the beat, decaying),
 * `onset` is how hard something is hitting now (0..1), `energy` the smoothed loudness.
 */
export function lightingAt(time: TimeOfDay, beat: number, down: number, onset: number, energy: number): Lighting {
  const shows = SHOWS[time];
  return {
    flash: clamp(0.05 * beat * beat + 0.06 * down * down, 0, 0.1) * (0.4 + 0.6 * energy) * (0.5 + 0.5 * shows),
    flare: clamp((onset - 0.5) / 0.4) * (0.35 + 0.65 * energy) * shows,
    rim: clamp((0.14 + 0.32 * energy + 0.24 * beat) * shows, 0, 0.7),
  };
}
