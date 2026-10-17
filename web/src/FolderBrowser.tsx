import { useEffect, useId, useState } from "react";
import { errorMessage, listFolder, makeFolder, type FolderListing } from "./api";

type Props = {
  title: string;
  /** "pickDir" chooses the folder you're in; "pickProject" also accepts a project folder. */
  mode: "pickDir" | "pickProject";
  confirmLabel: string;
  start?: string;
  onPick: (path: string) => void;
  onCancel: () => void;
};

const join = (dir: string, name: string) => (dir.endsWith("/") ? dir : dir + "/") + name;

export function FolderBrowser({ title, mode, confirmLabel, start = "", onPick, onCancel }: Props) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [typed, setTyped] = useState(start);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const titleId = useId();

  const go = async (path: string) => {
    try {
      const l = await listFolder(path);
      setListing(l);
      setTyped(l.path);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    go(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const create = async () => {
    if (!listing || !newName.trim()) return;
    try {
      const made = await makeFolder(join(listing.path, newName.trim()));
      setNewName("");
      await go(made.path);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const canPick = listing !== null && (mode === "pickDir" || listing.is_project);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId}>{title}</h2>
        <div className="row tight" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost btn-compact" disabled={!listing?.parent} onClick={() => listing?.parent && go(listing.parent)}>Up</button>
          <button className="btn btn-ghost btn-compact" disabled={!listing} onClick={() => listing && go(listing.home)}>Home</button>
          <input className="grow" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go(typed)} aria-label="Folder path" autoFocus />
          <button className="btn btn-ghost btn-compact" onClick={() => go(typed)}>Go</button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="list">
          {!listing && !error && <p className="hint" style={{ padding: 12 }}>Loading…</p>}
          {listing?.dirs.length === 0 && <p className="hint" style={{ padding: 12 }}>No subfolders.</p>}
          {listing?.dirs.map((d) => (
            <button key={d.name} onClick={() => go(join(listing.path, d.name))}>
              <span>{d.name}</span>
              {d.is_project && <span className="tag tag-acid">project</span>}
            </button>
          ))}
        </div>
        <div className="row tight">
          <input className="grow" placeholder="New folder name" aria-label="New folder name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          <button className="btn btn-ghost btn-compact" disabled={!newName.trim()} onClick={create}>Create</button>
        </div>
        {mode === "pickProject" && listing && !listing.is_project && <p className="hint">Go into a folder that contains a project.json (tagged "project"), then choose it.</p>}
        <div className="btn-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!canPick} onClick={() => listing && onPick(listing.path)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
