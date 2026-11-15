import { useEffect, useState } from "react";
import type { Section, SectionEdit, SectionsApplied } from "../../shared/types";
import { errorMessage, saveSectionDescriptions, saveSections } from "./api";
import { useAlive } from "./jobs";
import { moveStart, removeSection, renameSection, splitSection } from "./sectionsOps";
import { fmtRange } from "./time";

type Props = {
  projectId: string;
  sections: Section[];
  descriptions: string[];
  /** True once the sections were edited by hand; re-running analysis would replace them. */
  edited: boolean;
  /** Called before a structural edit so the plan and storyboard on screen are saved and then re-indexed, not overwritten. */
  beforeEdit: () => Promise<void>;
  onChange: (d: string[]) => void;
  onApplied: (applied: SectionsApplied) => void;
};

/** A seconds field that only commits on blur or Enter, so typing "12." doesn't try to save a half-typed time. */
function TimeField({ value, label, onCommit }: { value: number; label: string; onCommit: (t: number) => void }) {
  const [draft, setDraft] = useState(value.toFixed(2));
  useEffect(() => setDraft(value.toFixed(2)), [value]);
  const commit = () => {
    const t = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(t) || Math.abs(t - value) < 0.005) return setDraft(value.toFixed(2));
    onCommit(t);
  };
  return (
    <input
      type="number"
      step={0.01}
      min={0}
      aria-label={label}
      style={{ width: 84 }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

/** The song's sections: where each starts and ends, and what you want to see in it. Style plan and storyboard both follow them. */
export function SectionsPanel({ projectId, sections, descriptions, edited, beforeEdit, onChange, onApplied }: Props) {
  const [drafts, setDrafts] = useState<string[]>(() => sections.map((_, i) => descriptions[i] ?? ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useAlive();

  // Resets when the sections themselves change (re-analysis or an edit here); the panel is remounted per project, and
  // syncing on `descriptions` would overwrite whatever was typed while a save was in flight.
  useEffect(() => {
    setDrafts(sections.map((_, i) => descriptions[i] ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  const save = async () => {
    const sent = drafts;
    if (sent.every((d, i) => d === (descriptions[i] ?? ""))) return;
    await saveSectionDescriptions(projectId, sent);
    if (!alive.current) return;
    onChange(sent);
  };

  const saveDescriptions = async () => {
    try {
      await save();
      if (alive.current) setError("");
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    }
  };

  const apply = async (build: () => SectionEdit[]) => {
    setBusy(true);
    setError("");
    try {
      const edits = build();
      // Typed descriptions are part of what gets re-indexed, so they go first.
      await save();
      await beforeEdit();
      const applied = await saveSections(projectId, edits);
      if (alive.current) onApplied(applied);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>Sections</h2>
      <p className="hint">
        Each section is one scene. Split one to add a scene (the new part starts as a copy of it), or set where each one starts. Your style plan, storyboard and descriptions follow.
        {edited && " Re-running analysis would replace these edits."}
      </p>
      {error && <p className="error">{error}</p>}
      <table>
        <tbody>
          {sections.map((s, i) => (
            <tr key={i} className={i > 0 ? "sep" : undefined}>
              <td style={{ width: 230 }}>
                <input
                  type="text"
                  aria-label={`Section ${i + 1} name`}
                  defaultValue={s.label}
                  key={`${i}-${s.label}`}
                  disabled={busy}
                  style={{ width: "100%", boxSizing: "border-box" }}
                  onBlur={(e) => e.target.value.trim() !== s.label && apply(() => renameSection(sections, i, e.target.value))}
                />
                <div className="row tight" style={{ marginTop: 6 }}>
                  {i === 0 ? <span className="time">0.00</span> : <TimeField value={s.start} label={`Section ${i + 1} start (seconds)`} onCommit={(t) => apply(() => moveStart(sections, i, t))} />}
                  <span className="time">to {s.end.toFixed(2)}s</span>
                </div>
                <div className="time">{fmtRange(s.start, s.end)}</div>
                <div className="row tight" style={{ marginTop: 6 }}>
                  <button className="btn btn-ghost btn-compact" disabled={busy} onClick={() => apply(() => splitSection(sections, i))}>Split</button>
                  <button className="btn btn-ghost btn-compact" disabled={busy || sections.length < 2} onClick={() => apply(() => removeSection(sections, i))}>Remove</button>
                </div>
              </td>
              <td>
                <textarea
                  rows={3}
                  style={{ width: "100%", boxSizing: "border-box" }}
                  placeholder="e.g. rainy city street at night, the singer walking alone"
                  aria-label={`${s.label} description`}
                  value={drafts[i] ?? ""}
                  onChange={(e) => setDrafts((ds) => ds.map((d, j) => (j === i ? e.target.value : d)))}
                  onBlur={saveDescriptions}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
