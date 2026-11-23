import { clamp } from "../timing";

/** What the music asks of the scenery right now. */
export type SceneryMood = {
  /** 0..1: a gust on a hard hit; trees and grass lean over for it. */
  gust: number;
  /** 0..1: the smoothed loudness, which sways trees harder, leaps flames and swells waves. */
  energy: number;
  /** 0..1: how bright lamps, windows and glints are, swelling on each beat. */
  glow: number;
  /** 0..1: how much windows and lamps flicker, more on hard hits. */
  flicker: number;
};

export const CALM: SceneryMood = { gust: 0, energy: 0.4, glow: 0.4, flicker: 0.2 };

/** `energy` is the smoothed loudness, `onset` how hard something hits now, `pulse` the beat envelope (1 on a beat). */
export function sceneryMood(energy: number, onset: number, pulse: number): SceneryMood {
  return { gust: clamp((onset - 0.4) / 0.6), energy: clamp(energy), glow: clamp(0.45 * energy + 0.55 * pulse), flicker: clamp(0.15 + 0.85 * onset) };
}
