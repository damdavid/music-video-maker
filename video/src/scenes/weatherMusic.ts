import { clamp } from "../timing";

export type WeatherMood = {
  /** 0.2..1: how much weather there is: loud passages bring heavier rain and snow and thicker fog. */
  amount: number;
  /** 0..1: a gust on a hard hit, leaning the rain and shaking the snow. */
  gust: number;
};

/** The weather the music asks for: `energy` is the smoothed loudness, `onset` how hard something is hitting now (both 0..1). */
export function weatherMood(energy: number, onset: number): WeatherMood {
  return { amount: clamp(0.25 + 0.7 * energy + 0.15 * onset, 0.2, 1), gust: clamp((onset - 0.4) / 0.6) };
}

/** Opacity of the nth of `count` drops: the first ones are always there and the rest fade in as `amount` rises. */
export const dropOpacity = (n: number, count: number, amount: number) => clamp((amount - n / count) * 5 + 0.15);
