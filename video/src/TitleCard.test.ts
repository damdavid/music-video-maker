import { describe, expect, it } from "vitest";
import { cardPhase } from "./TitleCard";

describe("cardPhase", () => {
  it("fades in, holds and fades out over the opening window, and then is gone", () => {
    expect(cardPhase(0, 100, 6, false)?.opacity).toBe(0);
    expect(cardPhase(3, 100, 6, false)?.opacity).toBe(1);
    expect(cardPhase(5.9, 100, 6, false)!.opacity).toBeLessThan(0.2);
    expect(cardPhase(6, 100, 6, false)).toBeNull();
  });

  it("shows no closing card for a lyric video, and one for a lyric-less video", () => {
    expect(cardPhase(98, 100, 4, false)).toBeNull();
    expect(cardPhase(98, 100, 4, true)?.window).toBe(4);
  });

  it("uses a faster fade on a short window so it still holds at full opacity", () => {
    expect(cardPhase(1.0, 100, 2, false)?.opacity).toBe(1);
  });
});
