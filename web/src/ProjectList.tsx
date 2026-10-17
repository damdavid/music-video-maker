import { useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "../../shared/types";
import { errorMessage, forgetProject, importBundle, listProjects, openFolder } from "./api";
import { FolderBrowser } from "./FolderBrowser";

type Props = { currentId: string | null; reloadToken: number; onOpen: (id: string) => void; onNew: () => void; onChanged: () => void };

const badge = (on: boolean, label: string) => <span className={`tag ${on ? "tag-acid" : "tag-off"}`}>{label}</span>;

export function ProjectList({ currentId, reloadToken, onOpen, onNew, onChanged }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState<"open" | "import" | null>(null);
  const [bundle, setBundle] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listProjects().then(setProjects, (e) => setError(errorMessage(e)));
  }, [reloadToken]);

  const attempt = async (work: () => Promise<void>) => {
    setError("");
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="panel">
      <h2>Projects</h2>
      <div className="btn-row spaced">
        <button className="btn btn-primary btn-compact" onClick={onNew}>New project</button>
        <button className="btn btn-secondary btn-compact" onClick={() => setPicking("open")}>Open folder…</button>
        <button className="btn btn-secondary btn-compact" onClick={() => fileInput.current?.click()}>Import .mvm…</button>
        <input
          ref={fileInput}
          type="file"
          accept=".mvm"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) {
              setBundle(f);
              setPicking("import");
            }
          }}
        />
      </div>
      {error && <p className="error">{error}</p>}
      {projects === null && !error && <p className="hint">Loading…</p>}
      {projects?.length === 0 && <p className="hint">No projects yet.</p>}
      <div style={{ maxHeight: 260, overflow: "auto" }}>
        {projects?.map((p) => (
          <div key={p.id} className={`project-row${p.id === currentId ? " current" : ""}${p.missing ? " missing" : ""}`}>
            <button className="btn btn-ghost btn-compact" disabled={p.id === currentId || p.missing} onClick={() => onOpen(p.id)}>Open</button>
            <div className="grow">
              <div>
                <strong>{p.title || (p.missing ? p.title : "(untitled)")}</strong> {p.artist && <span className="muted">— {p.artist}</span>}
              </div>
              <div className="path" title={p.path}>{p.missing ? "folder not found · " : ""}{p.path}</div>
            </div>
            {!p.missing && (
              <>
                <span className="caption mtf-caption">{new Date(p.modified * 1000).toLocaleString()}</span>
                {badge(p.has_analysis, "analysis")}
                {badge(p.has_lyrics, "lyrics")}
                {badge(p.has_plan, "plan")}
                {badge(p.has_video, "video")}
              </>
            )}
            <button className="iconbtn" title="Remove from this list (files stay on disk)" onClick={() => attempt(async () => { await forgetProject(p.id); onChanged(); })}>✕</button>
          </div>
        ))}
      </div>

      {picking === "open" && (
        <FolderBrowser
          title="Open a project folder"
          mode="pickProject"
          confirmLabel="Open this folder"
          onCancel={() => setPicking(null)}
          onPick={(path) => {
            setPicking(null);
            attempt(async () => onOpen((await openFolder(path)).id));
          }}
        />
      )}
      {picking === "import" && bundle && (
        <FolderBrowser
          title={`Import ${bundle.name} into…`}
          mode="pickDir"
          confirmLabel="Import here"
          onCancel={() => setPicking(null)}
          onPick={(path) => {
            setPicking(null);
            attempt(async () => {
              const imported = await importBundle(bundle, path);
              onChanged();
              onOpen(imported.id);
            });
          }}
        />
      )}
    </section>
  );
}
