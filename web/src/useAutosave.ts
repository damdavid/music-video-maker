import { useCallback, useEffect, useRef, useState } from "react";
import type { Meta, Settings } from "../../shared/types";
import { errorMessage, saveDetails, setLyricsText } from "./api";

const DEBOUNCE_MS = 800;

type Values = { meta: Meta; settings: Settings; lyrics: string };
export type SaveState = "idle" | "saving" | "saved" | "error";

const snapshot = (v: Values) => JSON.stringify(v);

/**
 * Saves song details, settings and lyrics text a moment after they change. What a project had when it was opened
 * is the baseline, so opening one never rewrites it. Saves run one at a time and always write the newest values.
 */
export function useAutosave(projectId: string | null, values: Values) {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const latest = useRef({ projectId, values });
  latest.current = { projectId, values };
  const baseline = useRef<{ id: string | null; snap: string }>({ id: null, snap: "" });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const snap = snapshot(values);

  /**
   * Rejects if the save fails. `force` saves even if nothing changed since open, for a project whose details were never
   * written (just created). `target` names that project before it's the current one (its id isn't rendered yet).
   */
  const flush = useCallback((force = false, target?: string): Promise<void> => {
    const run = queue.current.then(async () => {
      const id = target ?? latest.current.projectId;
      const v = latest.current.values;
      if (!id) return;
      const s = snapshot(v);
      if (!force && baseline.current.id === id && baseline.current.snap === s) return;
      setState("saving");
      try {
        await setLyricsText(id, v.lyrics);
        await saveDetails(id, v.meta, v.settings);
        // Another project may have been opened meanwhile; its baseline is what it was opened with.
        if (latest.current.projectId !== id) return;
        baseline.current = { id, snap: s };
        setError("");
        setState("saved");
      } catch (e) {
        if (latest.current.projectId === id) {
          setError(errorMessage(e));
          setState("error");
        }
        throw e;
      }
    });
    // A failed save must not stop later ones from running; callers that need the result still see the rejection.
    queue.current = run.catch(() => {});
    return run;
  }, []);

  useEffect(() => {
    if (!projectId) {
      baseline.current = { id: null, snap: "" };
      setState("idle");
      return;
    }
    if (baseline.current.id !== projectId) {
      baseline.current = { id: projectId, snap };
      setState("idle");
      return;
    }
    if (snap === baseline.current.snap) return;
    const timer = window.setTimeout(() => flush().catch(() => {}), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [projectId, snap, flush]);

  // Warn rather than silently drop edits that haven't reached the server.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const dirty = projectId !== null && (state === "saving" || state === "error" || snap !== baseline.current.snap);
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [projectId, state, snap]);

  return { state, error, flush };
}
