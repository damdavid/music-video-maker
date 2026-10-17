// Renders the MusicVideo composition to MP4 and reports progress as JSON lines on stdout.
// Usage: node render.mjs --props props.json --out video.mp4 [--seconds N]
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Bundling is a fixed-cost prefix, so it takes the first slice of the progress bar.
const BUNDLE_SHARE = 0.1;

async function main() {
  const propsPath = arg("props");
  const out = arg("out");
  const seconds = arg("seconds") ? Number(arg("seconds")) : null;
  if (!propsPath || !out) throw new Error("--props and --out are required");
  if (seconds !== null && !(seconds > 0)) throw new Error(`--seconds must be a positive number, got ${arg("seconds")}`);

  const inputProps = JSON.parse(fs.readFileSync(propsPath, "utf8"));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  emit({ type: "stage", stage: "bundling", progress: 0 });
  const serveUrl = await bundle({
    entryPoint: path.join(here, "src/index.ts"),
    onProgress: (p) => emit({ type: "stage", stage: "bundling", progress: (p / 100) * BUNDLE_SHARE }),
  });

  try {
    const composition = await selectComposition({ serveUrl, id: "MusicVideo", inputProps });
    const frames = seconds ? Math.max(1, Math.min(composition.durationInFrames, Math.round(seconds * composition.fps))) : null;

    emit({ type: "stage", stage: "rendering", progress: BUNDLE_SHARE });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: out,
      inputProps,
      frameRange: frames ? [0, frames - 1] : null,
      onProgress: ({ progress, stitchStage }) =>
        emit({ type: "stage", stage: stitchStage === "muxing" ? "encoding" : "rendering", progress: BUNDLE_SHARE + progress * (1 - BUNDLE_SHARE) }),
    });

    emit({ type: "done", out, width: composition.width, height: composition.height, fps: composition.fps });
  } finally {
    // Each bundle is a fresh temp folder of its own; left behind, every render would leave another one.
    fs.rmSync(serveUrl, { recursive: true, force: true });
  }
}

main().catch((err) => {
  emit({ type: "error", message: String(err?.message ?? err) });
  process.exit(1);
});
