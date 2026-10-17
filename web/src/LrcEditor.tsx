import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import type { AnalysisData, Lyrics } from "../../shared/types";
import { errorMessage, importLrc, lrcUrl, saveLyrics } from "./api";
import { useAlive } from "./jobs";
import { nudge, setLineTimes, tapLine, updateLine } from "./lyricsOps";

type Props = { projectId: string; audioSrc: string; analysis: AnalysisData; lyrics: Lyrics; onChange: (l: Lyrics) => void };

const NUDGE = 0.01;

export function LrcEditor({ projectId, audioSrc, analysis, lyrics, onChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const regions = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const lyricsRef = useRef(lyrics);
  lyricsRef.current = lyrics;
  const alive = useAlive();
  const [rawSelected, setSelected] = useState(0);
  const [tap, setTap] = useState(false);
  const [status, setStatus] = useState("");
  const lastLine = lyrics.lines.length - 1;
  // Lines can shrink under the selection (e.g. importing a shorter .lrc).
  const selected = Math.max(0, Math.min(rawSelected, lastLine));

  useEffect(() => {
    const plugin = RegionsPlugin.create();
    const wave = WaveSurfer.create({ container: container.current!, url: audioSrc, height: 140, waveColor: "#4a524d", progressColor: "#39ff14", plugins: [plugin] });
    ws.current = wave;
    regions.current = plugin;
    plugin.on("region-updated", (r) => {
      const i = Number(r.id.replace("line-", ""));
      const line = lyricsRef.current.lines[i];
      if (!line) return;
      onChange(updateLine(lyricsRef.current, i, setLineTimes(line, r.start, r.end)));
    });
    plugin.on("region-clicked", (r, e) => {
      e.stopPropagation();
      const i = Number(r.id.replace("line-", ""));
      if (!Number.isNaN(i)) setSelected(i);
    });
    return () => wave.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSrc]);

  useEffect(() => {
    const plugin = regions.current;
    const wave = ws.current;
    if (!plugin || !wave) return;
    const draw = () => {
      plugin.clearRegions();
      analysis.sections.forEach((s, i) =>
        plugin.addRegion({ id: `section-${i}`, start: s.start, end: s.end, color: i % 2 ? "rgba(80,80,160,0.12)" : "rgba(80,160,80,0.12)", drag: false, resize: false }),
      );
      analysis.downbeats.forEach((t, i) => plugin.addRegion({ id: `downbeat-${i}`, start: t, color: "rgba(255,200,0,0.6)", drag: false, resize: false }));
      lyrics.lines.forEach((l, i) =>
        plugin.addRegion({ id: `line-${i}`, start: l.start, end: l.end, content: l.text, color: i === selected ? "rgba(255,80,120,0.45)" : "rgba(80,160,255,0.3)" }),
      );
    };
    // Regions are added once the waveform has decoded; unsubscribing keeps only the newest pending draw.
    if (wave.getDuration()) draw();
    else return wave.once("ready", draw);
  }, [lyrics, analysis, selected]);

  // Scoped to this panel so arrows/Space/Enter elsewhere on the page keep their usual meaning.
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select, button, a, [contenteditable]")) return;
    const wave = ws.current;
    const line = lyrics.lines[selected];
    if (!wave || !line) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (tap && wave.isPlaying()) {
        onChange(tapLine(lyrics, selected, wave.getCurrentTime()));
        setSelected(Math.min(selected + 1, lastLine));
      } else wave.playPause();
    } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      e.preventDefault();
      const d = e.code === "ArrowLeft" ? -NUDGE : NUDGE;
      // Shift moves only the start edge.
      onChange(updateLine(lyrics, selected, e.shiftKey ? nudge(line, d, 0) : nudge(line, d, d)));
    } else if (e.code === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(selected - 1, 0));
    } else if (e.code === "ArrowDown") {
      e.preventDefault();
      setSelected(Math.min(selected + 1, lastLine));
    } else if (e.code === "Enter") {
      wave.setTime(line.start);
      wave.play();
    }
  };

  // Clicked controls take focus, and then Space would toggle them instead of tapping.
  const refocus = () => panel.current?.focus();

  const line = lyrics.lines[selected];

  return (
    <section ref={panel} className="panel" tabIndex={0} onKeyDown={onKey} aria-label="Lyrics sync">
      <h2>Lyrics sync</h2>
      <div ref={container} style={{ marginTop: 16 }} />
      <div className="row" style={{ margin: "12px 0" }}>
        <button
          className="btn btn-secondary btn-compact"
          onClick={() => {
            ws.current?.playPause();
            refocus();
          }}
        >
          Play / pause
        </button>
        <label>
          <input
            type="checkbox"
            checked={tap}
            onChange={(e) => {
              setTap(e.target.checked);
              refocus();
            }}
          />{" "}
          Tap-to-sync (Space while playing sets the start of the selected line)
        </label>
      </div>
      <small className="hint">Click here first, then: ↑/↓ select line · Enter play from line · ←/→ nudge 10 ms (Shift: start only) · drag/resize regions</small>
      <ol className="lines" role="listbox" aria-label="Lyric lines">
        {lyrics.lines.map((l, i) => (
          <li key={i} role="option" aria-selected={i === selected} onClick={() => setSelected(i)} className={i === selected ? "selected" : undefined}>
            <code>{l.start.toFixed(2)}</code> {l.text}
            {l.words?.some((w) => w.low_confidence) && <span title="low-confidence words"> ⚠</span>}
          </li>
        ))}
      </ol>
      {line?.words && line.words.length > 0 && (
        <div>
          <strong>Words (selected line)</strong>
          <div className="row tight">
            {line.words.map((w, wi) => (
              <label key={wi} className="word" data-low={w.low_confidence ? "true" : undefined}>
                {w.text}{" "}
                <input
                  type="number"
                  step={0.01}
                  value={w.start}
                  style={{ width: 70 }}
                  onChange={(e) => {
                    const start = e.target.valueAsNumber;
                    // Clearing the field mid-edit would otherwise jump the word to 0.
                    if (Number.isNaN(start)) return;
                    const words = line.words!.map((x, j) => (j === wi ? { ...x, start, end: Math.max(x.end, start) } : x));
                    onChange(updateLine(lyrics, selected, { ...line, words }));
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn btn-primary btn-compact"
          onClick={async () => {
            setStatus("Saving…");
            try {
              await saveLyrics(projectId, lyrics);
              setStatus("Saved");
            } catch (e) {
              setStatus(`Save failed: ${errorMessage(e)}`);
            }
          }}
        >
          Save
        </button>
        <a className="mtf-link" href={lrcUrl(projectId, false)} download="lyrics.lrc">Export .lrc</a>
        <a className="mtf-link" href={lrcUrl(projectId, true)} download="lyrics.enhanced.lrc">Export enhanced</a>
        <label>
          Import .lrc{" "}
          <input
            type="file"
            accept=".lrc,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              // Cleared so choosing the same file again still fires onChange.
              e.target.value = "";
              if (!f) return;
              try {
                const imported = await importLrc(projectId, await f.text());
                if (!alive.current) return;
                onChange(imported);
                setStatus("Imported");
              } catch (err) {
                setStatus(`Import failed: ${errorMessage(err)}`);
              }
            }}
          />
        </label>
        {status}
      </div>
    </section>
  );
}
