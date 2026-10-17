import { useState } from "react";
import { setApiKey, useApiKey } from "./apiKey";

export function ApiKeyField() {
  const key = useApiKey();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function save() {
    setApiKey(draft.trim());
    setDraft("");
    setEditing(false);
  }

  if (key && !editing) {
    return (
      <div className="api-key">
        <span className="mtf-caption">Claude API key ••••{key.slice(-4)}</span>
        <button className="btn btn-secondary btn-compact" onClick={() => setEditing(true)}>Change</button>
        <button className="btn btn-secondary btn-compact" onClick={() => setApiKey("")}>Remove</button>
      </div>
    );
  }
  return (
    <form
      className="api-key"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="mtf-caption" htmlFor="api-key-input">Claude API key</label>
      <input
        id="api-key-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="sk-ant-…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        title="Stored only in this browser and sent to the local backend with each Claude request"
      />
      <button className="btn btn-primary btn-compact" type="submit" disabled={!draft.trim()}>Save</button>
      {editing && (
        <button className="btn btn-secondary btn-compact" type="button" onClick={() => { setDraft(""); setEditing(false); }}>Cancel</button>
      )}
    </form>
  );
}
