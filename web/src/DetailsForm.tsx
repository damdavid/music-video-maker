import type { Meta, Settings } from "../../shared/types";
import { TagsInput } from "./TagsInput";

type Props = { meta: Meta; settings: Settings; onMeta: (m: Meta) => void; onSettings: (s: Settings) => void };

export function DetailsForm({ meta, settings, onMeta, onSettings }: Props) {
  const set = <K extends keyof Meta>(k: K, v: Meta[K]) => onMeta({ ...meta, [k]: v });
  return (
    <fieldset className="panel">
      <legend>Song details</legend>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <label className="form-row grow">
          <span className="field-label">Title</span>
          <input value={meta.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="form-row grow">
          <span className="field-label">Artist</span>
          <input value={meta.artist} onChange={(e) => set("artist", e.target.value)} />
        </label>
      </div>
      <label className="form-row">
        <span className="field-label">What is the song about? (meaning)</span>
        <textarea rows={3} value={meta.meaning} onChange={(e) => set("meaning", e.target.value)} />
      </label>
      <label className="form-row">
        <span className="field-label">Genre</span>
        <input value={meta.genre} onChange={(e) => set("genre", e.target.value)} />
      </label>
      <label className="form-row">
        <span className="field-label">Mood tags (comma separated)</span>
        <TagsInput value={meta.mood_tags ?? []} onChange={(tags) => set("mood_tags", tags)} />
      </label>
      <label className="form-row">
        <span className="field-label">Overall energy</span>
        <select value={meta.energy} onChange={(e) => set("energy", e.target.value as Meta["energy"])}>
          <option>low</option>
          <option>medium</option>
          <option>high</option>
        </select>
      </label>
      <label className="form-row">
        <span className="field-label">Influences / era</span>
        <input value={meta.influences} onChange={(e) => set("influences", e.target.value)} />
      </label>
      <div className="row">
        <label>
          Aspect{" "}
          <select value={settings.aspect ?? "16:9"} onChange={(e) => onSettings({ ...settings, aspect: e.target.value as Settings["aspect"] })}>
            <option>16:9</option>
            <option>9:16</option>
            <option>1:1</option>
          </select>
        </label>
        <label>
          Resolution{" "}
          <select value={settings.resolution ?? "1080p"} onChange={(e) => onSettings({ ...settings, resolution: e.target.value as Settings["resolution"] })}>
            <option>720p</option>
            <option>1080p</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={settings.lyric_video} onChange={(e) => onSettings({ ...settings, lyric_video: e.target.checked })} /> Lyric video (show lyrics on screen)
        </label>
      </div>
    </fieldset>
  );
}
