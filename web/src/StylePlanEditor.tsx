import { Fragment, useState } from "react";
import { PRESET_PARAMS } from "video/src/presets/params";
import type { PaletteOverride, Section, StyleGlobal, StylePlan, StyleSection } from "../../shared/types";
import { errorMessage, regenerateSection, saveStylePlan } from "./api";
import { FontPicker } from "./FontPicker";
import { useAlive } from "./jobs";
import { Select } from "./Select";
import { TagsInput } from "./TagsInput";
import { fmtRange } from "./time";
import { CAMERA_MOTIONS, LOOKS, LYRIC_ANIMATIONS, TRANSITIONS, TYPOGRAPHY, VISUAL_PRESETS } from "./vocab";

// The generated type is a union of fixed-length tuples; the backend enforces 2-8 colors.
const asOverride = (colors: string[]) => colors as PaletteOverride;
const FALLBACK_OVERRIDE = ["#000000", "#ffffff"];

// Takes an updater so async results merge into the latest plan instead of the one rendered when they started.
type Props = { projectId: string; plan: StylePlan; sections: Section[]; lyricVideo: boolean; onChange: (update: (p: StylePlan) => StylePlan) => void };

export function StylePlanEditor({ projectId, plan, sections, lyricVideo, onChange }: Props) {
  const [busy, setBusy] = useState<number | null>(null);
  const [tuning, setTuning] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const alive = useAlive();
  const g = plan.global;

  const setSection = (i: number, patch: Partial<StyleSection>) =>
    onChange((p) => ({ ...p, sections: p.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const setGlobal = (patch: Partial<StyleGlobal>) => onChange((p) => ({ ...p, global: { ...p.global, ...patch } }));

  return (
    <section className="panel">
      <h2>Style plan</h2>
      <p className="hint">Colors, camera, transitions and lyric style for every section — used in all visual modes.</p>
      {plan.rationale && <p className="mtf-body" style={{ fontStyle: "italic" }}>{plan.rationale}</p>}

      <h3>Global</h3>
      <div className="row tight">
        {g.palette.map((c, i) => (
          <input
            key={i}
            type="color"
            aria-label={`Palette color ${i + 1}`}
            value={c}
            onChange={(e) => setGlobal({ palette: g.palette.map((p, j) => (j === i ? e.target.value : p)) })}
          />
        ))}
        {/* Not a <label>: clicks on the panel's text would be forwarded to the toggle and close it. */}
        <div className="row tight">
          <span style={{ color: "var(--fg-1)", fontSize: "var(--small-size)" }}>Font</span>
          <FontPicker value={g.font_family} onChange={(family) => setGlobal({ font_family: family })} />
        </div>
        <label>
          Typography{" "}
          <Select value={g.typography_style} options={TYPOGRAPHY} onChange={(v) => setGlobal({ typography_style: v })} />
        </label>
        <label>
          Background{" "}
          <Select value={g.background_preset} options={VISUAL_PRESETS} onChange={(v) => setGlobal({ background_preset: v })} />
        </label>
        <label>
          Look <Select value={g.look ?? "clean"} options={LOOKS} onChange={(v) => setGlobal({ look: v })} />
        </label>
        <label>
          Grain{" "}
          <input type="range" min={0} max={1} step={0.05} value={g.grain ?? 0} onChange={(e) => setGlobal({ grain: Number(e.target.value) })} />
        </label>
        <label>
          Vignette{" "}
          <input type="range" min={0} max={1} step={0.05} value={g.vignette ?? 0} onChange={(e) => setGlobal({ vignette: Number(e.target.value) })} />
        </label>
      </div>

      <h3>Sections</h3>
      <div className="table-scroll">
      <table className="plan-table">
        <thead>
          <tr>
            <th>Section</th>
            <th>Visual</th>
            <th>Intensity</th>
            <th>Warmth</th>
            <th>Camera</th>
            {lyricVideo && <th>Lyrics</th>}
            <th>Transition</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {plan.sections.map((s, i) => {
            const name = String(sections[s.section_ref]?.label ?? s.section_ref);
            return (
            <Fragment key={i}>
            <tr className={i > 0 ? "sep" : undefined}>
              <td>
                <div>{sections[s.section_ref]?.label ?? s.section_ref}</div>
                {sections[s.section_ref] && <div className="time">{fmtRange(sections[s.section_ref].start, sections[s.section_ref].end)}</div>}
              </td>
              <td><Select aria-label={`${name} visual`} value={s.visual_preset} options={VISUAL_PRESETS} onChange={(v) => setSection(i, { visual_preset: v, preset_params: {} })} /></td>
              <td><input type="range" aria-label={`${name} intensity`} min={0} max={1} step={0.05} value={s.intensity} onChange={(e) => setSection(i, { intensity: Number(e.target.value) })} /></td>
              <td><input type="range" aria-label={`${name} warmth`} min={-1} max={1} step={0.1} value={s.palette_shift ?? 0} onChange={(e) => setSection(i, { palette_shift: Number(e.target.value) })} /></td>
              <td><Select aria-label={`${name} camera`} value={s.camera_motion ?? "none"} options={CAMERA_MOTIONS} onChange={(v) => setSection(i, { camera_motion: v })} /></td>
              {lyricVideo && <td><Select aria-label={`${name} lyrics`} value={s.lyric_animation ?? "pop"} options={LYRIC_ANIMATIONS} onChange={(v) => setSection(i, { lyric_animation: v })} /></td>}
              <td><Select aria-label={`${name} transition`} value={s.transition_in ?? "crossfade"} options={TRANSITIONS} onChange={(v) => setSection(i, { transition_in: v })} /></td>
              <td className="actions">
                <button
                  className="btn btn-ghost btn-compact"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(i);
                    try {
                      // Persist edits first so the regenerated section is judged against the current plan.
                      await saveStylePlan(projectId, plan);
                      const regenerated = await regenerateSection(projectId, i);
                      if (!alive.current) return;
                      setSection(i, regenerated);
                      setStatus("");
                    } catch (e) {
                      setStatus(errorMessage(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === i ? "…" : "Regenerate"}
                </button>
                <button className="btn btn-ghost btn-compact" onClick={() => setTuning(tuning === i ? null : i)}>{tuning === i ? "Close" : "Tune"}</button>
              </td>
            </tr>
            {tuning === i && (
              <tr>
                <td colSpan={lyricVideo ? 8 : 7} style={{ background: "var(--bg-2)" }}>
                  <div className="row">
                    {PRESET_PARAMS[s.visual_preset].map((spec) => (
                      <label key={spec.key}>
                        {spec.label}{" "}
                        <input
                          type="range"
                          min={spec.min}
                          max={spec.max}
                          step={spec.step}
                          value={Number(s.preset_params?.[spec.key] ?? spec.default)}
                          onChange={(e) => setSection(i, { preset_params: { ...s.preset_params, [spec.key]: Number(e.target.value) } })}
                        />{" "}
                        {Number(s.preset_params?.[spec.key] ?? spec.default)}
                      </label>
                    ))}
                    <label>
                      <input
                        type="checkbox"
                        checked={!!s.palette_override}
                        onChange={(e) => setSection(i, { palette_override: e.target.checked ? asOverride(g.palette.length >= 2 ? g.palette.slice(0, 8) : FALLBACK_OVERRIDE) : undefined })}
                      />{" "}
                      Custom palette for this section
                    </label>
                    {s.palette_override?.map((c, ci) => (
                      <input
                        key={ci}
                        type="color"
                        aria-label={`${name} palette color ${ci + 1}`}
                        value={c}
                        onChange={(e) => setSection(i, { palette_override: asOverride(s.palette_override!.map((x, j) => (j === ci ? e.target.value : x))) })}
                      />
                    ))}
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>

      <label className="form-row" style={{ marginTop: 16 }}>
        <span className="field-label">Emphasis words (comma separated)</span>
        <TagsInput value={plan.emphasis_words ?? []} onChange={(words) => onChange((p) => ({ ...p, emphasis_words: words }))} />
      </label>
      <button
        className="btn btn-secondary"
        onClick={async () => {
          try {
            await saveStylePlan(projectId, plan);
            setStatus("Saved");
          } catch (e) {
            setStatus(errorMessage(e));
          }
        }}
      >
        Save plan
      </button>{" "}
      {status}
    </section>
  );
}
