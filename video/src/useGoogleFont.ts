import { useEffect, useRef, useState } from "react";
import { continueRender, delayRender } from "remotion";

const FALLBACK = "system-ui, sans-serif";
const TIMEOUT_MS = 8000;
// Every face the lyric and title styles use (see WEIGHT in LyricLayer). Google answers with whichever of these the
// family has, so asking for weights a family lacks is harmless.
const AXES = "ital,wght@0,400;0,500;0,700;0,800;1,400";
const FACES = ["400", "500", "700", "800", "italic 400"];
const sheets = new Map<string, Promise<void>>();
const faces = new Map<string, Promise<void>>();

function stylesheet(family: string): Promise<void> {
  let p = sheets.get(family);
  if (!p) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:${AXES}&display=swap`;
    document.head.appendChild(link);
    p = new Promise<void>((resolve, reject) => {
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`font stylesheet failed: ${family}`));
    });
    sheets.set(family, p);
  }
  return p;
}

/**
 * Loads every face of `family` that drawing `text` will need. `document.fonts.load` only fetches the faces (weights,
 * styles and unicode subsets) that match its arguments, so loading with the real text pulls in what non-Latin lyrics use.
 */
function load(family: string, text: string): Promise<void> {
  const key = `${family}\u0000${text}`;
  let p = faces.get(key);
  if (!p) {
    const sample = text.trim() || "AaBbCc";
    p = Promise.race([
      stylesheet(family)
        .then(() => Promise.all(FACES.map((face) => document.fonts.load(`${face} 1em "${family}"`, sample))))
        .then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, TIMEOUT_MS)),
    ]);
    faces.set(key, p);
  }
  return p;
}

/** Loads a Google Font and holds rendering until it's ready; falls back to a system font if it can't load. */
export function useGoogleFont(family: string, text = ""): string {
  const [handle] = useState(() => delayRender(`font ${family}`));
  const released = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    load(family, text)
      .catch(() => undefined) // a missing font shouldn't fail the render
      .finally(() => {
        if (!alive) return;
        setReady(true);
        if (!released.current) {
          released.current = true;
          continueRender(handle);
        }
      });
    return () => {
      alive = false;
    };
  }, [family, text, handle]);

  return ready ? `"${family}", ${FALLBACK}` : FALLBACK;
}
