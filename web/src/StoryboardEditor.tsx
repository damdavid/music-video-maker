import { Fragment, useState, type Dispatch, type SetStateAction } from "react";
import type { Character, CustomObject, Lyrics, ProcessStatus, Scene, SceneCharacter, SceneObject, Section, Storyboard } from "../../shared/types";
import { errorMessage, generateStoryboard, getStoryboard, illustrationStatus, regenerateScene, saveStoryboard, startIllustration } from "./api";
import { pollJob, useAlive } from "./jobs";
import { Select } from "./Select";
import { fmtRange } from "./time";
import { defaultExpression } from "video/src/scenes/face";
import { ACCESSORIES, ACTIONS, EXPRESSIONS, GENDERS, CONTACTS, HAIRS, HATS, HELD, SYMBOLS, ILLUSTRATIONS, OBJECT_SIZES, OUTFITS, PLACEMENTS, PROP_KINDS, SETTINGS, TIMES, WEATHERS, legacyGender } from "./vocab";

type PropKind = (typeof PROP_KINDS)[number];

// The generated types use fixed-length tuples for the capped lists; the editor works with plain arrays and
// the backend enforces the limits (cast <= 6, characters <= 3, props <= 4, objects <= 8, scene objects <= 3) on save.
type EScene = Omit<Scene, "characters" | "props" | "objects"> & { characters?: SceneCharacter[]; props?: PropKind[]; objects?: SceneObject[] };
type EBoard = Omit<Storyboard, "cast" | "scenes" | "objects"> & { cast?: Character[]; objects?: CustomObject[]; scenes?: EScene[] };
const asBoard = (b: EBoard) => b as unknown as Storyboard;
// A scene for a section the song no longer has can't be saved (the server rejects it), and would block every save.
const savable = (b: EBoard, sections: number) => asBoard({ ...b, scenes: (b.scenes ?? []).filter((s) => s.section_ref < sections) });
const asEBoard = (b: Storyboard | null) => (b ?? { illustration: "library", cast: [], scenes: [] }) as unknown as EBoard;
const POLL_MS = 1500;
/** Whether a section's direction differs from the one a scene (or its backdrop) was made from; a scene with no direction either way is not stale. */
const directionMoved = (current: string | undefined, used: string | undefined) => (current ?? "").trim() !== (used ?? "").trim();

type Props = {
  projectId: string;
  board: Storyboard | null;
  sections: Section[];
  sectionDescriptions: string[];
  /** Sets a section's direction (its note); `commit` saves it now rather than after a pause. */
  onDirection: (index: number, text: string, commit?: boolean) => void;
  /** The aligned lyrics, for setting the lead's expression line by line. */
  lyrics?: Lyrics | null;
  // Takes updaters so async results merge into the latest board instead of the one rendered when they started.
  onChange: Dispatch<SetStateAction<Storyboard | null>>;
};

const COLOR_KEYS = ["body", "hair", "top", "bottom", "accent"] as const;
const NEW_CHARACTER = (id: string): Character => ({
  id,
  name: "New character",
  gender: "male",
  hair: "short",
  outfit: "tee",
  build: 1,
  colors: { body: "#e0b090", hair: "#2a1a14", top: "#3b6ea8", bottom: "#222a44", accent: "#f1c40f" },
});

const NEW_OBJECT = (id: string): CustomObject => ({ id, name: "", description: "", size: "medium" });
const MAX_OBJECTS = 8;

// Counting from length + 1 alone would reuse a live id after a removal.
const nextId = (prefix: string, taken: { id: string }[]) => {
  let n = taken.length + 1;
  while (taken.some((x) => x.id === `${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
};

// Drawing only fills in art, so take just that from the server and keep any edits made while it ran.
const mergeArt = (cur: EBoard, fresh: EBoard): EBoard => ({
  ...cur,
  cast: cur.cast?.map((c) => ({ ...c, svg: fresh.cast?.find((f) => f.id === c.id)?.svg ?? c.svg })),
  objects: cur.objects?.map((o) => ({ ...o, svg: fresh.objects?.find((f) => f.id === o.id)?.svg ?? o.svg })),
  scenes: cur.scenes?.map((sc) => ({ ...sc, background_svg: fresh.scenes?.find((f) => f.section_ref === sc.section_ref)?.background_svg ?? sc.background_svg })),
});

const svgSrc = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

export function StoryboardEditor({ projectId, board, sections, sectionDescriptions, onDirection, lyrics, onChange }: Props) {
  const [busy, setBusy] = useState<"all" | number | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [art, setArt] = useState<ProcessStatus | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const alive = useAlive();
  const b = asEBoard(board);
  const cast = b.cast ?? [];
  const objects = b.objects ?? [];
  const scenes = b.scenes ?? [];
  const update = (f: (cur: EBoard) => EBoard) => {
    if (alive.current) onChange((prev) => asBoard(f(asEBoard(prev))));
  };
  const replace = (next: Storyboard) => {
    if (alive.current) onChange(next);
  };

  const run = async (which: "all" | number, work: () => Promise<void>) => {
    setBusy(which);
    setError("");
    setStatus("");
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const sceneFor = (i: number): EScene | undefined => scenes.find((s) => s.section_ref === i);
  const setScene = (i: number, patch: Partial<EScene>) =>
    update((cur) => {
      const all = cur.scenes ?? [];
      const next: EScene = { ...(all.find((s) => s.section_ref === i) ?? { section_ref: i, setting: "road" }), ...patch };
      return { ...cur, scenes: [...all.filter((s) => s.section_ref !== i), next].sort((x, y) => x.section_ref - y.section_ref) };
    });
  // Lyric cues are keyed by the line's start time, like moods; a cue with nothing left in it is dropped.
  const cueAt = (at: number) => (b.cues ?? []).find((c) => Math.abs(c.at - at) < 0.02);
  const setCue = (at: number, patch: Partial<NonNullable<Storyboard["cues"]>[number]>) =>
    update((cur) => {
      const was = (cur.cues ?? []).find((c) => Math.abs(c.at - at) < 0.02);
      const next = { at, symbol: null, holding: null, ...was, ...patch };
      const rest = (cur.cues ?? []).filter((c) => Math.abs(c.at - at) >= 0.02);
      return { ...cur, cues: [...rest, ...(next.symbol || next.holding ? [next] : [])].sort((x, y) => x.at - y.at) };
    });
  // A pair touching is set on one of its two characters; a character can be in only one pair, so choosing a partner clears theirs.
  const setContact = (i: number, ci: number, contact: SceneCharacter["contact"]) =>
    setScene(i, { characters: (scenes.find((sc) => sc.section_ref === i)?.characters ?? []).map((x, j) => (j === ci ? { ...x, contact } : contact && x.character_id === contact.partner ? { ...x, contact: null } : x)) });
  // What a character wears in one scene instead of their usual look; a scene's wear with nothing set is dropped.
  const setWear = (i: number, ci: number, patch: NonNullable<SceneCharacter["wear"]>) =>
    setScene(i, {
      characters: (scenes.find((sc) => sc.section_ref === i)?.characters ?? []).map((x, j) => {
        if (j !== ci) return x;
        const wear = { ...(x.wear ?? {}), ...patch };
        return { ...x, wear: wear.outfit == null && wear.hat == null && wear.accessories == null ? null : wear };
      }),
    });
  // Redoes one scene from its direction. Persists edits first so the redo is judged against the current storyboard; objects Claude
  // defines for it join the board (their art is drawn with Draw art).
  const redoScene = (i: number) =>
    run(i, async () => {
      await saveStoryboard(projectId, savable(b, sections.length));
      const redo = await regenerateScene(projectId, i);
      setScene(i, redo.scene as unknown as EScene);
      const made = redo.new_objects ?? [];
      if (made.length) update((cur) => ({ ...cur, objects: [...(cur.objects ?? []), ...made.filter((o) => !(cur.objects ?? []).some((x) => x.id === o.id))] }));
    });
  const characterLabel = (id: string) => cast.find((c) => c.id === id)?.name?.trim() || id;
  const objectLabel = (id: string) => objects.find((o) => o.id === id)?.name?.trim() || id;
  const setObject = (idx: number, patch: Partial<CustomObject>) =>
    update((cur) => ({ ...cur, objects: (cur.objects ?? []).map((o, j) => (j === idx ? { ...o, ...patch } : o)) }));
  const setCharacter = (idx: number, patch: Partial<Character>) =>
    update((cur) => ({ ...cur, cast: (cur.cast ?? []).map((c, j) => (j === idx ? { ...c, ...patch } : c)) }));
  const removeObject = (id: string) =>
    update((cur) => ({
      ...cur,
      objects: (cur.objects ?? []).filter((o) => o.id !== id),
      scenes: (cur.scenes ?? []).map((sc) => ({ ...sc, objects: (sc.objects ?? []).filter((so) => so.object_id !== id) })),
    }));
  const removeCharacter = (id: string) =>
    update((cur) => ({
      ...cur,
      cast: (cur.cast ?? []).filter((c) => c.id !== id),
      scenes: (cur.scenes ?? []).map((sc) => ({ ...sc, characters: (sc.characters ?? []).filter((x) => x.character_id !== id) })),
    }));

  // Saves first so the chosen modes are what gets drawn, then polls the background job and reloads the finished art.
  const drawArt = async (target?: { scenes?: number[]; characters?: string[]; objects?: string[] }) => {
    setDrawing(true);
    setError("");
    setStatus("");
    try {
      await saveStoryboard(projectId, savable(b, sections.length));
      const first = await startIllustration(projectId, target);
      const st = await pollJob(first, () => illustrationStatus(projectId), { intervalMs: POLL_MS, alive: () => alive.current, onProgress: setArt });
      if (!st) return;
      setArt(st);
      if (st.state === "error") throw new Error(st.error ?? "drawing failed");
      const fresh = await getStoryboard(projectId);
      if (fresh) update((cur) => mergeArt(cur, asEBoard(fresh)));
      setStatus(st.stage);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDrawing(false);
    }
  };
  const working = busy !== null || drawing;
  const defaultMode = b.illustration ?? "library";

  return (
    <section className="panel">
      <h2>Storyboard</h2>
      <p className="hint">Illustrated scenes for scenes/both modes; drawn with the Style Plan's palette and motion.</p>
      <div className="row spaced">
        <button
          className="btn btn-primary"
          disabled={working}
          onClick={() =>
            run("all", async () => {
              // Custom objects live in the storyboard, so save them first; generating keeps them.
              if (board) await saveStoryboard(projectId, savable(b, sections.length));
              replace(await generateStoryboard(projectId));
            })
          }
        >
          {busy === "all" ? "Generating…" : board?.scenes?.length ? "Regenerate storyboard" : "Generate storyboard"}
        </button>
        {busy === "all" && <span className="hint">Asking Claude — this can take up to a minute at higher effort levels.</span>}
      </div>
      {error && <p className="error">Storyboard failed: {error}</p>}

      <h3>Objects</h3>
      <p className="hint">Your own props. Claude places them in scenes and draws each one when you press Draw art.</p>
      {objects.map((o, idx) => (
        <div key={idx} className="card row" style={{ alignItems: "flex-start" }}>
          <div className="thumb">{o.svg ? <img src={svgSrc(o.svg)} alt={o.name || o.id} width={44} height={44} /> : <span className="hint">none</span>}</div>
          <div className="grow stack">
            <div className="row tight">
              <strong className="mono">{o.id}</strong>
              <input className="grow" value={o.name ?? ""} placeholder="Name (e.g. Old guitar)" onChange={(e) => setObject(idx, { name: e.target.value })} />
              <label>Size <Select value={o.size ?? "medium"} options={OBJECT_SIZES} onChange={(v) => setObject(idx, { size: v })} /></label>
            </div>
            <textarea rows={2} value={o.description ?? ""} placeholder="What it looks like" onChange={(e) => setObject(idx, { description: e.target.value })} />
          </div>
          <div className="stack">
            <button className="btn btn-ghost btn-compact" disabled={working} onClick={() => drawArt({ objects: [o.id] })}>{o.svg ? "Redraw" : "Draw"}</button>
            <button className="btn btn-ghost btn-compact" onClick={() => removeObject(o.id)}>
              Remove
            </button>
          </div>
        </div>
      ))}
      {objects.length < MAX_OBJECTS && (
        <button className="btn btn-secondary btn-compact" onClick={() => update((cur) => ({ ...cur, objects: [...(cur.objects ?? []), NEW_OBJECT(nextId("object", cur.objects ?? []))] }))}>
          Add object
        </button>
      )}

      {(board || cast.length > 0) && (
        <>
          <div className="row spaced" style={{ marginTop: 24 }}>
            <label>
              Illustration <Select value={defaultMode} options={ILLUSTRATIONS} onChange={(v) => update((cur) => ({ ...cur, illustration: v }))} />
            </label>
            <span className="hint">library = the built-in rigged figures and scenery; freeform = SVG drawn by Claude</span>
          </div>
          <div className="row">
            <button className="btn btn-secondary" disabled={working || !board} title={board ? "" : "Generate a storyboard first"} onClick={() => drawArt()}>
              {drawing ? "Drawing…" : "Draw art"}
            </button>
            <span className="hint">draws missing character and backdrop art for free-form scenes, plus any custom objects</span>
          </div>
          {drawing && art && (
            <p>
              <progress value={art.progress} max={1} /> {Math.round(art.progress * 100)}% — {art.stage}
            </p>
          )}
          <h3>Cast</h3>
          {cast.map((c, idx) => (
            <div key={idx} className="card row">
              <strong className="mono">{c.id}</strong>
              <input value={c.name ?? ""} placeholder="Name" onChange={(e) => setCharacter(idx, { name: e.target.value })} />
              <label>Gender <Select value={c.gender ?? legacyGender(c.hair, c.outfit)} options={GENDERS} onChange={(v) => setCharacter(idx, { gender: v })} /></label>
              <label>Hair <Select value={c.hair ?? "short"} options={HAIRS} onChange={(v) => setCharacter(idx, { hair: v })} /></label>
              <label>Outfit <Select value={c.outfit ?? "tee"} options={OUTFITS} onChange={(v) => setCharacter(idx, { outfit: v })} /></label>
              <label>
                Hat{" "}
                <select aria-label={`${c.id} hat`} value={c.hat ?? ""} onChange={(e) => setCharacter(idx, { hat: (e.target.value || null) as Character["hat"] })}>
                  <option value="">none</option>
                  {HATS.map((h) => (
                    <option key={h} value={h}>{h.replace("_", " ")}</option>
                  ))}
                </select>
              </label>
              {ACCESSORIES.map((a) => {
                const worn: (typeof ACCESSORIES)[number][] = c.accessories ?? [];
                const on = worn.includes(a);
                return (
                  <label key={a} title={on || worn.length < 2 ? "" : "At most two accessories"}>
                    <input type="checkbox" checked={on} disabled={!on && worn.length >= 2} onChange={(e) => setCharacter(idx, { accessories: (e.target.checked ? [...worn, a] : worn.filter((x) => x !== a)) as Character["accessories"] })} /> {a}
                  </label>
                );
              })}
              <label>
                Build{" "}
                <input type="range" min={0.85} max={1.15} step={0.01} value={c.build ?? 1} onChange={(e) => setCharacter(idx, { build: Number(e.target.value) })} />
              </label>
              {COLOR_KEYS.map((k) => (
                <label key={k} title={k}>
                  {k}{" "}
                  <input type="color" value={c.colors[k]} onChange={(e) => setCharacter(idx, { colors: { ...c.colors, [k]: e.target.value } })} />
                </label>
              ))}
              <span className="hint">{c.svg ? "art ✓" : "no art"}</span>
              <button className="btn btn-ghost btn-compact" disabled={working || !board} onClick={() => drawArt({ characters: [c.id] })}>Redraw art</button>
              <button className="btn btn-ghost btn-compact" onClick={() => removeCharacter(c.id)}>Remove</button>
              {c.description && <span className="hint" style={{ flexBasis: "100%" }}>{c.description}</span>}
            </div>
          ))}
          {cast.length < 6 && <button className="btn btn-secondary btn-compact" onClick={() => update((cur) => ({ ...cur, cast: [...(cur.cast ?? []), NEW_CHARACTER(nextId("char", cur.cast ?? []))] }))}>Add character</button>}

          <h3>Scenes</h3>
          <table>
            <thead>
              <tr>
                <th>Section</th>
                <th>Setting</th>
                <th>Time</th>
                <th>Weather</th>
                <th>Crowd</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sections.map((section, i) => {
                const s = sceneFor(i);
                return (
                  <Fragment key={i}>
                    <tr className={i > 0 ? "sep" : undefined}>
                      <td>
                        <div>{section.label}</div>
                        <div className="time">{fmtRange(section.start, section.end)}</div>
                      </td>
                      {s ? (
                        <>
                          <td><Select aria-label={`${section.label} setting`} value={s.setting} options={SETTINGS} onChange={(v) => setScene(i, { setting: v })} /></td>
                          <td><Select aria-label={`${section.label} time of day`} value={s.time_of_day ?? "night"} options={TIMES} onChange={(v) => setScene(i, { time_of_day: v })} /></td>
                          <td><Select aria-label={`${section.label} weather`} value={s.weather ?? "clear"} options={WEATHERS} onChange={(v) => setScene(i, { weather: v })} /></td>
                          <td><input type="number" aria-label={`${section.label} crowd`} title="Leave empty to let the renderer add a crowd in energetic sections; 0 for none" placeholder="auto" min={0} max={8} style={{ width: 60 }} value={s.crowd ?? ""} onChange={(e) => setScene(i, { crowd: e.target.value === "" ? null : Math.min(8, Math.max(0, Number(e.target.value) || 0)) })} /></td>
                        </>
                      ) : (
                        <td colSpan={4}>
                          <span className="hint">No scene (uses the abstract visuals)</span>{" "}
                          <button className="btn btn-ghost btn-compact" onClick={() => setScene(i, { setting: "road" })}>Add scene</button>
                        </td>
                      )}
                      <td>
                        <button
                          className="btn btn-ghost btn-compact"
                          disabled={working || !board}
                          title={board ? "" : "Generate a storyboard first"}
                          onClick={() => redoScene(i)}
                        >
                          {busy === i ? "…" : "Regenerate"}
                        </button>
                      </td>
                    </tr>
                    {s && (
                      <tr>
                        <td />
                        <td colSpan={5} style={{ paddingBottom: 14 }}>
                          <label className="field-label" style={{ display: "block" }}>Your direction for this section</label>
                          <textarea
                            rows={2}
                            style={{ width: "100%", boxSizing: "border-box" }}
                            placeholder="What should this part show? e.g. a river with a stone bridge at dawn, two travellers, a lighthouse far off"
                            aria-label={`${section.label} direction`}
                            value={sectionDescriptions[i] ?? ""}
                            onChange={(e) => onDirection(i, e.target.value)}
                            onBlur={(e) => onDirection(i, e.target.value, true)}
                          />
                          {directionMoved(sectionDescriptions[i], s.direction_used) && (
                            <p className="hint" style={{ margin: "4px 0 0" }}>
                              This direction has changed since the scene was planned.{" "}
                              <button className="btn btn-ghost btn-compact" disabled={working || !board} onClick={() => redoScene(i)}>Redo scene from direction</button>
                            </p>
                          )}
                          {s.background_svg && directionMoved(sectionDescriptions[i], s.art_direction) && (
                            <p className="hint" style={{ margin: "4px 0 0" }}>
                              This direction has changed since the backdrop was drawn.{" "}
                              <button className="btn btn-ghost btn-compact" disabled={working || !board} onClick={() => drawArt({ scenes: [i] })}>Redraw backdrop</button>
                            </p>
                          )}
                          {s.description?.trim() && <p className="hint" style={{ margin: "6px 0 0" }}>Claude's plan: {s.description}</p>}
                          <label className="field-label" style={{ display: "block", marginTop: 6 }} title="Things from your direction the backdrop must show clearly. Redraw the backdrop after changing them.">
                            Must show in the backdrop{" "}
                            <input
                              key={`${i}-${(s.include ?? []).join("|")}`}
                              style={{ width: "100%", boxSizing: "border-box" }}
                              placeholder="comma separated, e.g. river, stone bridge"
                              aria-label={`${section.label} must show`}
                              defaultValue={(s.include ?? []).join(", ")}
                              onBlur={(e) => setScene(i, { include: e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 6) as Scene["include"] })}
                            />
                          </label>
                          <div className="row" style={{ marginTop: 6 }}>
                            <label>
                              Drawing{" "}
                              <select
                                value={s.illustration ?? ""}
                                onChange={(e) => setScene(i, { illustration: (e.target.value || undefined) as Scene["illustration"] })}
                              >
                                <option value="">default ({defaultMode})</option>
                                {ILLUSTRATIONS.map((o) => (
                                  <option key={o}>{o}</option>
                                ))}
                              </select>
                            </label>
                            <span className="hint">{s.background_svg ? "backdrop ✓" : "no backdrop"}</span>
                            <button className="btn btn-ghost btn-compact" disabled={working || !board} onClick={() => drawArt({ scenes: [i] })}>Redraw backdrop</button>
                          </div>
                          <div className="row" style={{ marginTop: 6 }}>
                            {PROP_KINDS.map((k) => (
                              <label key={k}>
                                <input
                                  type="checkbox"
                                  checked={(s.props ?? []).includes(k)}
                                  onChange={(e) => setScene(i, { props: e.target.checked ? [...(s.props ?? []), k].slice(0, 4) : (s.props ?? []).filter((p) => p !== k) })}
                                />{" "}
                                {k}
                              </label>
                            ))}
                          </div>
                          {(s.characters ?? []).map((sc, ci) => (
                            <div key={ci} className="row tight" style={{ marginTop: 6 }}>
                              <Select
                                aria-label="Character"
                                value={sc.character_id}
                                options={cast.map((c) => c.id)}
                                label={characterLabel}
                                onChange={(v) => setScene(i, { characters: (s.characters ?? []).map((x, j) => (j === ci ? { ...x, character_id: v } : x)) })}
                              />
                              <Select aria-label="Action" value={sc.action ?? "idle"} options={ACTIONS} onChange={(v) => setScene(i, { characters: (s.characters ?? []).map((x, j) => (j === ci ? { ...x, action: v } : x)) })} />
                              <Select
                                aria-label="Expression"
                                value={sc.expression ?? "auto"}
                                options={["auto", ...EXPRESSIONS] as const}
                                label={(v) => (v === "auto" ? `auto (${defaultExpression(sc.action ?? "idle")})` : v)}
                                onChange={(v) => setScene(i, { characters: (s.characters ?? []).map((x, j) => (j === ci ? { ...x, expression: v === "auto" ? null : v } : x)) })}
                              />
                              <Select aria-label="Placement" value={sc.placement ?? "center"} options={PLACEMENTS} onChange={(v) => setScene(i, { characters: (s.characters ?? []).map((x, j) => (j === ci ? { ...x, placement: v } : x)) })} />
                              <Select aria-label="Facing" value={sc.facing ?? "right"} options={["left", "right"] as const} onChange={(v) => setScene(i, { characters: (s.characters ?? []).map((x, j) => (j === ci ? { ...x, facing: v } : x)) })} />
                              <Select
                                aria-label="Holding"
                                value={sc.holding ?? "nothing"}
                                options={["nothing", ...HELD] as const}
                                label={(v) => (v === "nothing" ? "holding nothing" : `holding ${v}`)}
                                onChange={(v) => setScene(i, { characters: (s.characters ?? []).map((x, j) => (j === ci ? { ...x, holding: v === "nothing" ? null : v } : x)) })}
                              />
                              <Select
                                aria-label="Looks at"
                                value={sc.looks_at ?? "nobody"}
                                options={["nobody", "camera", ...(s.characters ?? []).filter((_, j) => j !== ci).map((x) => x.character_id)]}
                                label={(v) => (v === "nobody" ? "looks at nobody" : v === "camera" ? "looks at the camera" : `looks at ${characterLabel(v)}`)}
                                onChange={(v) => setScene(i, { characters: (s.characters ?? []).map((x, j) => (j === ci ? { ...x, looks_at: v === "nobody" ? null : v } : x)) })}
                              />
                              <Select
                                aria-label="Outfit this scene"
                                value={sc.wear?.outfit ?? "cast"}
                                options={["cast", ...OUTFITS] as const}
                                label={(v) => (v === "cast" ? "usual outfit" : `wears ${v}`)}
                                onChange={(v) => setWear(i, ci, { outfit: v === "cast" ? null : v })}
                              />
                              <Select
                                aria-label="Hat this scene"
                                value={sc.wear?.hat ?? "cast"}
                                options={["cast", "none", ...HATS] as const}
                                label={(v) => (v === "cast" ? "usual hat" : v === "none" ? "no hat" : `hat: ${v.replace("_", " ")}`)}
                                onChange={(v) => setWear(i, ci, { hat: v === "cast" ? null : v })}
                              />
                              <Select
                                aria-label="Accessory this scene"
                                value={sc.wear?.accessories == null ? "cast" : (sc.wear.accessories[0] ?? "none")}
                                options={["cast", "none", ...ACCESSORIES] as const}
                                label={(v) => (v === "cast" ? "usual accessories" : v === "none" ? "no accessories" : v)}
                                onChange={(v) => setWear(i, ci, { accessories: v === "cast" ? null : v === "none" ? [] : sc.wear?.accessories?.[1] && sc.wear.accessories[1] !== v ? [v, sc.wear.accessories[1]] : [v] })}
                              />
                              {sc.wear?.accessories?.[0] && (
                                <Select
                                  aria-label="Second accessory this scene"
                                  value={sc.wear.accessories[1] ?? "none"}
                                  options={["none", ...ACCESSORIES.filter((a) => a !== sc.wear?.accessories?.[0])] as const}
                                  label={(v) => (v === "none" ? "no second accessory" : `and ${v}`)}
                                  onChange={(v) => setWear(i, ci, { accessories: v === "none" ? [sc.wear!.accessories![0]] : [sc.wear!.accessories![0], v] })}
                                />
                              )}
                              <Select
                                aria-label="Contact"
                                value={sc.contact?.kind ?? "none"}
                                options={["none", ...CONTACTS] as const}
                                label={(v) => (v === "none" ? "no contact" : v.replace("_", " "))}
                                onChange={(v) => setContact(i, ci, v === "none" ? null : { partner: sc.contact?.partner ?? (s.characters ?? []).find((_, j) => j !== ci)?.character_id ?? "", kind: v })}
                              />
                              {sc.contact && (
                                <Select
                                  aria-label="Contact with"
                                  value={sc.contact.partner}
                                  options={(s.characters ?? []).filter((_, j) => j !== ci).map((x) => x.character_id)}
                                  label={(v) => `with ${characterLabel(v)}`}
                                  onChange={(v) => setContact(i, ci, { partner: v, kind: sc.contact!.kind })}
                                />
                              )}
                              <button className="btn btn-ghost btn-compact" onClick={() => setScene(i, { characters: (s.characters ?? []).filter((_, j) => j !== ci) })}>Remove</button>
                            </div>
                          ))}
                          {(s.characters ?? []).length < 3 && cast.length > 0 && (
                            <button className="btn btn-ghost btn-compact" style={{ marginTop: 6 }} onClick={() => setScene(i, { characters: [...(s.characters ?? []), { character_id: cast[0].id, action: "idle", placement: "center", facing: "right" }] })}>
                              Add character to scene
                            </button>
                          )}
                          {(s.objects ?? []).map((so, oi) => {
                            const patch = (p: Partial<SceneObject>) => setScene(i, { objects: (s.objects ?? []).map((x, j) => (j === oi ? { ...x, ...p } : x)) });
                            return (
                              <div key={oi} className="row tight" style={{ marginTop: 6 }}>
                                <span className="hint">Object</span>
                                <Select aria-label="Object" value={so.object_id} options={objects.map((o) => o.id)} label={objectLabel} onChange={(v) => patch({ object_id: v })} />
                                <Select aria-label="Object placement" value={so.placement ?? "right"} options={PLACEMENTS} onChange={(v) => patch({ placement: v })} />
                                <button className="btn btn-ghost btn-compact" onClick={() => setScene(i, { objects: (s.objects ?? []).filter((_, j) => j !== oi) })}>Remove</button>
                              </div>
                            );
                          })}
                          {(s.objects ?? []).length < 3 && objects.length > 0 && (
                            <button className="btn btn-ghost btn-compact" style={{ marginTop: 6, marginLeft: 8 }} onClick={() => setScene(i, { objects: [...(s.objects ?? []), { object_id: objects[0].id, placement: "right" }] })}>
                              Add object to scene
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {lyrics && lyrics.lines.length > 0 && b.cast?.length ? (
            <details>
              <summary>Expressions, symbols and items by lyric line ({(b.moods ?? []).length + (b.cues ?? []).length} set)</summary>
              <p className="hint">The lead's face takes the expression from the start of the line, until the next one is set (at most 8 seconds); leave it as "scene" to use the scene's own. A symbol pops up beside the lead for a couple of seconds. An item is put in the lead's hand until a later line gives them another (at most 8 seconds).</p>
              <table className="plan-table">
                <tbody>
                  {lyrics.lines.map((line, k) => {
                    const at = Math.round(line.start * 100) / 100;
                    const mood = (b.moods ?? []).find((m) => Math.abs(m.at - at) < 0.02)?.expression ?? "";
                    return (
                      <tr key={k}>
                        <td className="time">{fmtRange(line.start, line.start)}</td>
                        <td>{line.text}</td>
                        <td>
                          <select aria-label={`Expression for line ${k + 1}`} value={mood} onChange={(e) => update((cur) => ({ ...cur, moods: [...(cur.moods ?? []).filter((m) => Math.abs(m.at - at) >= 0.02), ...(e.target.value ? [{ at, expression: e.target.value as NonNullable<Scene["characters"]>[number]["expression"] & string }] : [])].sort((x, y) => x.at - y.at) }))}>
                            <option value="">scene</option>
                            {EXPRESSIONS.map((x) => (
                              <option key={x} value={x}>{x}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select aria-label={`Symbol for line ${k + 1}`} value={cueAt(at)?.symbol ?? ""} onChange={(e) => setCue(at, { symbol: (e.target.value || null) as NonNullable<Storyboard["cues"]>[number]["symbol"] })}>
                            <option value="">no symbol</option>
                            {SYMBOLS.map((x) => (
                              <option key={x} value={x}>{x}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select aria-label={`Item for line ${k + 1}`} value={cueAt(at)?.holding ?? ""} onChange={(e) => setCue(at, { holding: (e.target.value || null) as NonNullable<Storyboard["cues"]>[number]["holding"] })}>
                            <option value="">no item</option>
                            {HELD.map((x) => (
                              <option key={x} value={x}>{x}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          ) : null}
          <div className="row spaced">
            <button
              className="btn btn-secondary"
              disabled={working}
              onClick={() =>
                run("all", async () => {
                  await saveStoryboard(projectId, savable(b, sections.length));
                  setStatus("Saved");
                })
              }
            >
              Save storyboard
            </button>
            {status}
          </div>
        </>
      )}
    </section>
  );
}
