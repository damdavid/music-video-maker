import { useEffect, useRef } from "react";

const MAX_FAILURES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Job = { state: string; error?: string | null };

/**
 * Polls a background job until it finishes. Returns the final status, or null once `alive()` turns false (the view
 * moved on), so callers drop the result. Rides out a few failed requests; a missing job (404) is an error.
 */
export async function pollJob<S extends Job>(
  first: S,
  fetchStatus: () => Promise<S | null>,
  { intervalMs, alive, onProgress }: { intervalMs: number; alive: () => boolean; onProgress: (s: S) => void },
): Promise<S | null> {
  let s = first;
  let failures = 0;
  while (s.state !== "done" && s.state !== "error") {
    if (!alive()) return null;
    onProgress(s);
    await sleep(intervalMs);
    let next: S | null;
    try {
      next = await fetchStatus();
      failures = 0;
    } catch (e) {
      if (++failures >= MAX_FAILURES) throw e;
      continue;
    }
    if (!alive()) return null;
    if (!next) throw new Error("the job is gone (the server may have restarted); try again");
    s = next;
  }
  return alive() ? s : null;
}

/** False after unmount, so async work started by a component doesn't write into whatever replaced it. */
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}
