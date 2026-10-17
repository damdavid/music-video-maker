import { Player } from "@remotion/player";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { MusicVideo } from "video/src/MusicVideo";
import { videoSize } from "video/src/size";
import type { AnalysisData, Lyrics, Meta, ProcessStatus, Settings, Storyboard, StyleEffort, StylePlan, VisualMode } from "../../shared/types";
import {
  audioUrl,
  createProject,
  createStylePlan,
  errorMessage,
  exportUrl,
  getAnalysis,
  getLyrics,
  getProject,
  getStoryboard,
  getStylePlan,
  listProjects,
  processStatus,
  saveProjectAs,
  startProcess,
} from "./api";
import { ApiKeyField } from "./ApiKeyField";
import { DebugView } from "./DebugView";
import { DetailsForm } from "./DetailsForm";
import { ExportPanel } from "./ExportPanel";
import { FolderBrowser } from "./FolderBrowser";
import { pollJob } from "./jobs";
import { LrcEditor } from "./LrcEditor";
import { ProjectList } from "./ProjectList";
import { SectionsPanel } from "./SectionsPanel";
import { StoryboardEditor } from "./StoryboardEditor";
import { StylePlanEditor } from "./StylePlanEditor";
import { useAutosave } from "./useAutosave";
import { EFFORTS, VISUAL_MODES } from "./vocab";

const FPS = 30;

const EMPTY_META: Meta = { title: "", artist: "", meaning: "", genre: "", mood_tags: [], energy: "medium", influences: "" };
const DEFAULT_SETTINGS: Settings = { lyric_video: true, aspect: "16:9", resolution: "1080p", fps: FPS };
const POLL_MS = 1000;
const PLAYER_STYLE = { width: "100%", maxHeight: "80vh", margin: "16px 0", border: "1px solid var(--line-bright)", borderRadius: 4 };

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [lyrics, setLyrics] = useState("");
  const [status, setStatus] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [lyricsData, setLyricsData] = useState<Lyrics | null>(null);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [plan, setPlan] = useState<StylePlan | null>(null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [sectionDescriptions, setSectionDescriptions] = useState<string[]>([]);
  const [projectPath, setProjectPath] = useState("");
  const [location, setLocation] = useState("");
  const [browsing, setBrowsing] = useState<"location" | "saveAs" | null>(null);

  const [progress, setProgress] = useState<ProcessStatus | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Kept apart from `status`, which renders at the top of the page, far from the Generate button.
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState("");

  // Bumped whenever the open project changes, synchronously (before any re-render), so async work started for
  // one project can tell it must drop its results.
  const generation = useRef(0);
  // The latest open/new request wins over slower ones still loading.
  const switching = useRef(0);

  const autosave = useAutosave(projectId, { meta, settings, lyrics });

  const busy = progress !== null && (progress.state === "queued" || progress.state === "running");

  function clearProjectState() {
    generation.current++;
    setAnalysis(null);
    setLyricsData(null);
    setPlan(null);
    setStoryboard(null);
    setSectionDescriptions([]);
    setProjectPath("");
    setProgress(null);
    setPlanBusy(false);
    setPlanError("");
  }

  function reset() {
    clearProjectState();
    setFile(null);
    setLyrics("");
    setStatus("");
    setProjectId(null);
    setMeta(EMPTY_META);
    setSettings(DEFAULT_SETTINGS);
  }

  /** Saves pending edits before leaving the project. False if a newer switch superseded this one or the user stays. */
  async function leaveProject(token: number) {
    try {
      await autosave.flush();
    } catch (e) {
      if (!window.confirm(`Couldn't save your latest edits (${errorMessage(e)}). Switch anyway?`)) return false;
    }
    return token === switching.current;
  }

  async function newProject() {
    if (await leaveProject(++switching.current)) reset();
  }

  // Saves pending edits first so the bundle matches what's on screen.
  async function exportBundle(id: string) {
    try {
      await autosave.flush();
      const a = document.createElement("a");
      a.href = exportUrl(id);
      a.download = "";
      a.click();
    } catch (e) {
      setStatus(`Export failed: ${errorMessage(e)}`);
    }
  }

  // Where the project lives on disk, for the header.
  function showPath(id: string) {
    const gen = generation.current;
    listProjects().then((all) => gen === generation.current && setProjectPath(all.find((p) => p.id === id)?.path ?? ""), () => {});
  }

  async function openProject(id: string) {
    const token = ++switching.current;
    if (!(await leaveProject(token))) return;
    try {
      setStatus("Opening…");
      const [project, a, l, sp, sb] = await Promise.all([getProject(id), getAnalysis(id), getLyrics(id), getStylePlan(id), getStoryboard(id)]);
      if (token !== switching.current) return;
      reset();
      setProjectId(id);
      setLyrics(project.lyrics_text ?? "");
      setMeta({ ...EMPTY_META, ...project.meta });
      setSettings({ ...DEFAULT_SETTINGS, ...project.settings });
      setAnalysis(a);
      setLyricsData(l);
      setPlan(sp);
      setStoryboard(sb);
      setSectionDescriptions(project.section_descriptions ?? []);
      setStatus("");
      showPath(id);
    } catch (e) {
      if (token === switching.current) setStatus(errorMessage(e));
    }
  }

  // Runs analysis (+ vocal separation and alignment when there are lyrics) as a background job and waits for it.
  async function process(id: string) {
    const gen = generation.current;
    const current = () => gen === generation.current;
    await autosave.flush(true, id);
    if (!current()) return;
    let s: ProcessStatus | null;
    try {
      s = await pollJob(await startProcess(id), () => processStatus(id), { intervalMs: POLL_MS, alive: current, onProgress: setProgress });
    } catch (e) {
      if (current()) setProgress(null);
      throw e;
    }
    if (!s) return;
    setProgress(s);
    if (s.state === "error") throw new Error(s.error ?? "processing failed");
    const [a, l] = await Promise.all([getAnalysis(id), getLyrics(id)]);
    if (!current()) return;
    setAnalysis(a);
    setLyricsData(l);
    setReloadToken((n) => n + 1);
  }

  async function run(existing: boolean) {
    let gen = generation.current;
    try {
      let id = projectId;
      if (!existing) {
        if (!file) return;
        setStatus("Uploading…");
        id = (await createProject(file, lyrics, location)).id;
        if (gen !== generation.current) {
          setReloadToken((n) => n + 1);
          return;
        }
        // Keeps the song details and lyrics on screen for the new project, but none of the old one's results.
        clearProjectState();
        gen = generation.current;
        setFile(null);
        setProjectId(id);
        showPath(id);
      }
      setStatus("");
      await process(id!);
    } catch (e) {
      if (gen === generation.current) setStatus(errorMessage(e));
    }
  }

  async function makePlan() {
    if (!projectId) return;
    const gen = generation.current;
    setPlanError("");
    setPlanBusy(true);
    try {
      await autosave.flush(true);
      const p = await createStylePlan(projectId);
      if (gen === generation.current) setPlan(p);
    } catch (e) {
      if (gen === generation.current) setPlanError(errorMessage(e));
    } finally {
      if (gen === generation.current) setPlanBusy(false);
    }
  }

  const audioSrc = projectId ? audioUrl(projectId) : "";
  const fps = settings.fps ?? FPS;
  const { width, height } = videoSize(settings);
  const shownLyrics = settings.lyric_video === false ? null : lyricsData;
  const inputProps = useMemo(
    () => analysis && { analysis, lyrics: shownLyrics, plan, storyboard, meta, settings, audioSrc },
    [analysis, shownLyrics, plan, storyboard, meta, settings, audioSrc],
  );
  const updatePlan = useCallback((f: (p: StylePlan) => StylePlan) => setPlan((p) => p && f(p)), []);

  const sections = analysis?.sections ?? [];

  return (
    <main className="app">
      <header className="app-header">
        <img src="/mark.svg" alt="" />
        <div className="brand">
          <span className="wordmark">Music Video Maker</span>
          <span className="mtf-label-acid mtf-caption subtitle">Built by Mitch The Fat</span>
        </div>
        {projectPath && <span className="mtf-caption where" title={projectPath}>{projectPath}</span>}
        <ApiKeyField />
      </header>
      <ProjectList
        currentId={projectId}
        reloadToken={reloadToken}
        onOpen={openProject}
        onNew={newProject}
        onChanged={() => setReloadToken((n) => n + 1)}
      />

      <section className="panel">
        <h2>{projectId ? "Project" : "New project"}</h2>
        {projectId && (
          <div className="btn-row spaced">
            <button className="btn btn-secondary btn-compact" onClick={() => setBrowsing("saveAs")}>Save as…</button>
            <button className="btn btn-secondary btn-compact" onClick={() => exportBundle(projectId)}>Export .mvm</button>
            <span className="hint">
              Song details, lyrics and settings save automatically. Save the style plan and storyboard with their own buttons.
            </span>
            {autosave.state === "saving" && <span className="hint">Saving…</span>}
            {autosave.state === "saved" && <span className="hint">Saved</span>}
            {autosave.state === "error" && <span className="error">Couldn't save: {autosave.error}</span>}
          </div>
        )}
        <label className="form-row" style={{ marginTop: 16 }}>
          <span className="field-label">Audio (mp3)</span>
          <input key={projectId ?? "new"} type="file" accept="audio/mpeg,.mp3" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {!projectId && (
          <div className="form-row">
            <span className="field-label">Location</span>
            <div className="row tight">
              <input className="grow" value={location} placeholder="Default (the app's projects folder)" onChange={(e) => setLocation(e.target.value)} />
              <button className="btn btn-ghost btn-compact" onClick={() => setBrowsing("location")}>Browse…</button>
            </div>
          </div>
        )}
        <label className="form-row">
          <span className="field-label">Lyrics</span>
          <textarea rows={6} value={lyrics} onChange={(e) => setLyrics(e.target.value)} />
        </label>
      </section>

      <DetailsForm meta={meta} settings={settings} onMeta={setMeta} onSettings={setSettings} />
      <div className="btn-row spaced">
        <button className="btn btn-primary" disabled={!file || busy} onClick={() => run(false)}>{projectId ? "Upload as new project" : "Analyze & align"}</button>
        {projectId && <button className="btn btn-secondary" disabled={busy} onClick={() => run(true)}>Re-run analysis &amp; alignment</button>}
        {status}
      </div>
      {progress && busy && (
        <p>
          <progress value={progress.progress} max={1} /> {Math.round(progress.progress * 100)}% — {progress.stage}
        </p>
      )}
      {progress?.state === "error" && <p className="error">Processing failed: {progress.error}</p>}
      {analysis && projectId && (
        <Fragment key={projectId}>
          <DebugView analysis={analysis} />
          {lyricsData && <LrcEditor projectId={projectId} audioSrc={audioSrc} analysis={analysis} lyrics={lyricsData} onChange={setLyricsData} />}
          <SectionsPanel projectId={projectId} sections={sections} descriptions={sectionDescriptions} onChange={setSectionDescriptions} />
          <div className="row spaced">
            <label>
              Opus 5.5 effort{" "}
              <select
                value={settings.style_effort ?? "high"}
                onChange={(e) => {
                  setSettings({ ...settings, style_effort: e.target.value as StyleEffort });
                }}
              >
                {EFFORTS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Visual mode{" "}
              <select
                value={settings.visual_mode ?? "abstract"}
                onChange={(e) => {
                  setSettings({ ...settings, visual_mode: e.target.value as VisualMode });
                }}
              >
                {VISUAL_MODES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary" disabled={planBusy} onClick={makePlan}>
              {planBusy ? "Generating…" : plan ? "Regenerate style plan" : "Generate style plan"}
            </button>
            {planBusy && <span className="hint">Asking Claude — this can take up to a minute at higher effort levels.</span>}
          </div>
          {planError && <p className="error">Style plan failed: {planError}</p>}
          {plan && <StylePlanEditor projectId={projectId} plan={plan} sections={sections} lyricVideo={settings.lyric_video ?? true} onChange={updatePlan} />}
          <StoryboardEditor projectId={projectId} board={storyboard} sections={sections} sectionDescriptions={sectionDescriptions} onChange={setStoryboard} />
          {inputProps && (
            <Player
              component={MusicVideo}
              inputProps={inputProps}
              durationInFrames={Math.ceil(analysis.duration * fps)}
              compositionWidth={width}
              compositionHeight={height}
              fps={fps}
              controls
              style={PLAYER_STYLE}
            />
          )}
          <ExportPanel projectId={projectId} />
        </Fragment>
      )}

      {browsing === "location" && (
        <FolderBrowser
          title="Choose where the project is saved"
          mode="pickDir"
          confirmLabel="Use this folder"
          start={location}
          onCancel={() => setBrowsing(null)}
          onPick={(path) => {
            setLocation(path);
            setBrowsing(null);
          }}
        />
      )}
      {browsing === "saveAs" && projectId && (
        <FolderBrowser
          title="Save a copy of this project in…"
          mode="pickDir"
          confirmLabel="Save here"
          onCancel={() => setBrowsing(null)}
          onPick={async (path) => {
            setBrowsing(null);
            try {
              await autosave.flush(true);
              const copy = await saveProjectAs(projectId, path, meta.title ?? "");
              setReloadToken((n) => n + 1);
              await openProject(copy.id);
            } catch (e) {
              setStatus(errorMessage(e));
            }
          }}
        />
      )}
    </main>
  );
}
