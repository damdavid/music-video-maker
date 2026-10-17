import { useEffect, useRef, useState } from "react";
import type { RenderStatus } from "../../shared/types";
import { errorMessage, renderStatus, startRender, videoUrl } from "./api";
import { pollJob } from "./jobs";

const POLL_MS = 1000;
const CLIP_SECONDS = 15;

export function ExportPanel({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<RenderStatus | null>(null);
  const [error, setError] = useState("");
  // Each follow() bumps this, so a newer poll (or unmount) retires the older one.
  const run = useRef(0);

  const follow = async (begin: () => Promise<RenderStatus | null>) => {
    const me = ++run.current;
    const alive = () => run.current === me;
    setError("");
    try {
      const first = await begin();
      if (!alive()) return;
      setStatus(first);
      if (!first) return;
      const last = await pollJob(first, () => renderStatus(projectId), { intervalMs: POLL_MS, alive, onProgress: setStatus });
      if (last) setStatus(last);
    } catch (e) {
      if (alive()) setError(errorMessage(e));
    }
  };

  // Pick up a render that's already running (e.g. after a page reload) and stop polling on unmount.
  useEffect(() => {
    follow(() => renderStatus(projectId));
    return () => {
      run.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const start = (seconds?: number) => follow(() => startRender(projectId, seconds));

  const busy = status !== null && status.state !== "done" && status.state !== "error";

  return (
    <section className="panel">
      <h2>Export</h2>
      <div className="btn-row spaced">
        <button className="btn btn-primary" disabled={busy} onClick={() => start()}>Render MP4</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => start(CLIP_SECONDS)}>Render {CLIP_SECONDS}s preview</button>
      </div>
      {busy && status && (
        <p>
          <progress value={status.progress} max={1} /> {Math.round(status.progress * 100)}% — {status.state}
        </p>
      )}
      {status?.state === "done" && (
        <p>
          Done{status.width ? ` (${status.width}×${status.height} @ ${status.fps}fps)` : ""}:{" "}
          <a className="mtf-link" href={videoUrl(projectId, status.clip ?? false)} download>Download {status.clip ? "preview" : "MP4"}</a>
        </p>
      )}
      {status?.state === "error" && <p className="error">Render failed: {status.error}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
