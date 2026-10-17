import { useEffect, useRef, useState } from "react";
import { filterChoices, FONT_CHOICES, fontStack, previewStylesheetUrl } from "./fonts";

const SAMPLE = "Hold the light in your hands";
let previewsRequested = false;

/** Loads the preview typefaces the first time the picker opens. */
function requestPreviews() {
  if (previewsRequested) return;
  previewsRequested = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = previewStylesheetUrl(FONT_CHOICES.map((f) => f.family));
  document.head.appendChild(link);
}

type Props = { value: string; onChange: (family: string) => void };

/** Shows the current font in its own typeface and opens a list where every choice is previewed. Any Google Fonts name can also be typed. */
export function FontPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    requestPreviews();
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (family: string) => {
    onChange(family);
    setOpen(false);
    setQuery("");
    setCustom("");
  };

  const groups = filterChoices(query, value);

  return (
    <div className="font-picker" ref={root}>
      <button type="button" className="font-current" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} style={{ fontFamily: fontStack(value) }}>
        {value || "Choose a font"} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="font-panel" role="listbox" aria-label="Fonts">
          <input autoFocus placeholder="Search fonts" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="font-list">
            {groups.length === 0 && <p className="hint">No match. Type its Google Fonts name below.</p>}
            {groups.map((g) => (
              <div key={g.category}>
                <div className="font-group">{g.category}</div>
                {g.fonts.map((family) => (
                  <button type="button" role="option" aria-selected={family === value} key={family} className={`font-row${family === value ? " selected" : ""}`} onClick={() => pick(family)}>
                    <span className="font-name">{family}</span>
                    <span className="font-sample" style={{ fontFamily: fontStack(family) }}>{SAMPLE}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="row tight">
            <input
              className="grow"
              placeholder="Any other Google Fonts name"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && custom.trim() && pick(custom.trim())}
            />
            <button type="button" className="btn btn-ghost btn-compact" disabled={!custom.trim()} onClick={() => pick(custom.trim())}>Use</button>
          </div>
        </div>
      )}
    </div>
  );
}
