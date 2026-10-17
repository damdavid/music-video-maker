import type { Settings } from "../../shared/types";

const SHORT_SIDE = { "720p": 720, "1080p": 1080 } as const;

export function videoSize(settings: Pick<Settings, "aspect" | "resolution">): { width: number; height: number } {
  const short = SHORT_SIDE[settings.resolution ?? "1080p"];
  const long = Math.round((short * 16) / 9 / 2) * 2;
  switch (settings.aspect ?? "16:9") {
    case "9:16":
      return { width: short, height: long };
    case "1:1":
      return { width: short, height: short };
    default:
      return { width: long, height: short };
  }
}
