import { useEffect, useState } from "react";
import type { Section } from "../../shared/types";
import { errorMessage, saveSectionDescriptions } from "./api";
import { useAlive } from "./jobs";
import { fmtRange } from "./time";

type Props = { projectId: string; sections: Section[]; descriptions: string[]; onChange: (d: string[]) => void };

/** What you want to see in each part of the song. Claude follows these when it writes the style plan and the storyboard. */
export function SectionsPanel({ projectId, sections, descriptions, onChange }: Props) {
  const [drafts, setDrafts] = useState<string[]>(() => sections.map((_, i) => descriptions[i] ?? ""));
  const [error, setError] = useState("");
  const alive = useAlive();

  // Only a re-analysis (new sections) resets the drafts; the panel is remounted per project, and syncing on
  // `descriptions` would overwrite whatever was typed while a save was in flight.
  useEffect(() => {
    setDrafts(sections.map((_, i) => descriptions[i] ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  const save = async () => {
    const sent = drafts;
    if (sent.every((d, i) => d === (descriptions[i] ?? ""))) return;
    try {
      await saveSectionDescriptions(projectId, sent);
      if (!alive.current) return;
      onChange(sent);
      setError("");
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    }
  };

  return (
    <section className="panel">
      <h2>Sections</h2>
      <p className="hint">Describe the scene you want for each part of the song. The style plan and storyboard both follow these.</p>
      {error && <p className="error">{error}</p>}
      <table>
        <tbody>
          {sections.map((s, i) => (
            <tr key={i} className={i > 0 ? "sep" : undefined}>
              <td style={{ width: 150 }}>
                <div>{s.label}</div>
                <div className="time">{fmtRange(s.start, s.end)}</div>
              </td>
              <td>
                <textarea
                  rows={2}
                  style={{ width: "100%", boxSizing: "border-box" }}
                  placeholder="e.g. rainy city street at night, the singer walking alone"
                  aria-label={`${s.label} description`}
                  value={drafts[i] ?? ""}
                  onChange={(e) => setDrafts((ds) => ds.map((d, j) => (j === i ? e.target.value : d)))}
                  onBlur={save}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
