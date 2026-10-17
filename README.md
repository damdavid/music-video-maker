# music-video-maker

Turn a song into an audio-reactive music video. Upload an MP3 and lyrics, describe the song (meaning, genre, mood),
and get an MP4 whose visuals are generated entirely in code and driven by the audio. A per-project toggle switches
between a **lyric video** and a **visuals-only** video.

1. **Analyze** the audio: tempo, beats, sections, loudness/bass/treble, notes.
2. **Align lyrics** to the vocals (Demucs isolates the vocals, Whisper aligns your words) and fix the timing in a waveform editor. Export `.lrc` / enhanced `.lrc`.
3. **Style plan**: Claude turns your song details, structure and lyrics into a per-section plan (visual, intensity, palette, camera, lyric animation, transition). Edit anything, tune per-section parameters, or regenerate a single section.
4. **Storyboard** (optional): Claude designs a cast and one scene per section (setting, time of day, weather, props, characters with their actions and expressions), drawn as flat, stylized illustrations with simple faces, either from the built-in library or as free-form SVG that Claude draws. Edit anything or regenerate a single scene.
5. **Preview** live in the browser, then **render an MP4** (16:9, 9:16 or 1:1).

## Requirements

- Node 22+, [uv](https://docs.astral.sh/uv/) (Python 3.12 is pinned), and `ffmpeg` (`brew install ffmpeg`)
- An Anthropic API key for the Claude steps (style plan, storyboard, free-form art). Each user enters their own under **Claude API key** at the top right; it's kept in that browser's localStorage and sent only with Claude requests. The backend never reads `ANTHROPIC_API_KEY`, `ant auth login` or Claude Code's login
- Disk: first use downloads Demucs `htdemucs` (~80 MB) and Whisper `small` (~460 MB) to `~/.cache`, and the first render downloads Remotion's headless Chrome

## Setup and run

```bash
npm install
(cd backend && uv sync)
npm run dev          # API on :8000 and web app on http://localhost:5173
```

If `uv` is configured with a private package index, add `--default-index https://pypi.org/simple`.
`npm run dev` starts both servers; `npm run dev:api` / `npm run dev:web` start them separately.
Interactive API docs: http://localhost:8000/docs.

## Using it

1. **New project**: choose an MP3, paste lyrics, fill in the song details, optionally *Browse…* for the folder to save in, then *Analyze & align*. A progress bar shows each stage. Without lyrics, or with *Lyric video* off, alignment is skipped.
2. **Lyrics sync**: drag line regions on the waveform. `↑/↓` select a line, `Enter` plays from it, `←/→` nudge 10 ms (`Shift` moves only the start). *Tap-to-sync*: with it on, press `Space` while playing to set the selected line's start. Save, import or export `.lrc` from the same panel.
3. **Sections**: once analysis is done, describe the scene you want for each part of the song (shown with its start–end time). Claude follows these when writing the style plan and the storyboard.
4. **Style plan**: pick the Opus 5.5 effort level, *Generate style plan*, then edit. *Tune* opens per-section sliders and a custom palette; *Regenerate* redoes one section (your palette override is kept).
5. **Storyboard**: set *Visual mode* to `scenes` (illustrations only) or `both` (illustrations over the abstract visuals), then *Generate storyboard*. Edit the cast (hair, outfit, build, colors) and each scene (setting, time, weather, crowd, props, who does what, where). *Regenerate* redoes one scene. A section with no scene falls back to the abstract visuals.
   - **Illustration** chooses how scenes are drawn: `library` (built-in rigged figures and parametric scenery, no extra cost) or `freeform` (SVG that Claude draws). Each scene can override the default.
   - **Objects** are your own props (a name, a description, a size). Claude places them in scenes, draws each as an SVG when you press *Draw art* (in both `library` and `freeform`), and the renderer draws them over the backdrop. Objects without art are skipped.
   - In `freeform`, *Draw art* has Claude draw a character or a backdrop per asset (a few calls, run in parallel in the background with a progress bar). It only draws what's missing; *Redraw art* / *Redraw backdrop* redo one. Anything that fails or is missing falls back to the library art, so a scene never renders blank.
6. **Export**: *Render MP4* or a 15 s preview. Download the result when it finishes.

**Project files.** Song details, lyrics and settings save automatically a moment after you change them (the style plan and storyboard have their own Save buttons), into the project's folder, which can be anywhere: pick it with *Browse…* when creating a project, or *Save as…* to copy a project (without renders) to a new folder. *Open folder…* adds an existing project folder to the list; the ✕ on a row only removes it from the list. *Export .mvm* writes the whole project as one file (a zip of the project files, no renders) and *Import .mvm…* unpacks one into a folder you choose, under a new id. The list of known folders is kept in `projects/.registry.json`.

## How it works

Every frame is a pure function of `(frame, analysis, lyrics, plan, settings)`. Audio features are computed once at the video frame rate, so the browser preview and the exported MP4 match frame for frame, and renders are reproducible (randomness is seeded).

| Path | What |
|---|---|
| `backend/` | FastAPI + Python: analysis (librosa), vocal separation (Demucs), alignment (stable-ts / Whisper), LRC, style plan (Claude), background jobs, render runner |
| `video/` | Remotion composition: abstract presets, scene illustrations (`src/scenes/`), lyric layer, transitions, `render.mjs` (MP4 export) |
| `web/` | Vite + React editor that embeds the Remotion `Player` |
| `shared/` | `schema.json` generated from the Pydantic models, and the TypeScript types generated from it |
| `projects/<id>/` | Default location for project files (git-ignored; projects can live elsewhere): `audio.mp3`, `project.json`, `analysis.json`, `lyrics.json`, `style_plan.json`, `storyboard.json`, `vocals.wav`, `out/` |

Only one heavy job (analysis/alignment or a render) runs at a time; a second request returns `409`.

## Development

```bash
cd backend && uv run pytest        # backend tests
npm test                           # video tests (vitest)
npm run typecheck -w web           # also: -w video
npm run schema                     # after changing backend/app/models.py: regenerate shared/ types
```

**Scenes**: characters are a fixed 2D rig (`video/src/scenes/rig.ts`) posed by action functions (`actions.ts`); backgrounds, props, sky and weather are parametric SVG. Claude only picks from the allowed vocabulary (the `Literal` types in `backend/app/models.py`), so a storyboard can never name something the renderer can't draw. To add a setting, action or prop: extend the `Literal`, run `npm run schema`, then implement it in `video/src/scenes/` (the build fails until every case is handled where the types require it).

**Free-form art and safety**: SVG written by Claude is untrusted input. It goes through a strict allowlist (`backend/app/svgsafe.py`) when saved, and again in the renderer (`video/src/scenes/safeSvg.ts`), which rebuilds React elements from an allowlisted tree and never injects markup. Scripts, event handlers, `foreignObject`, external links and images, CSS and animation never survive. Both implementations pass the same malicious samples in `shared/svg-fixtures.json`, so change them together. Drawing conventions the prompts rely on: figures use `viewBox="0 0 100 200"` facing right with named, pivoted parts (`head`, `arm_r`, `forearm_r`, `leg_l`, `shin_l`, ...) that the pose engine rotates, and backdrops use `viewBox="0 0 1600 900"` with the ground line at y=693. A figure without parts still moves as a whole.

**Looks and motion**: the style plan's `look` is `clean` or `riso`. `riso` wraps the whole frame in a print finish (`video/src/riso/`): channel misregistration of 1-3 px, static paper grain and mottling, a dot screen and specks, all fixed in place (they never flicker) and seeded from the song, replacing the film grain and vignette; it also writes the title card with a pen. The `ripples` (a centre dot, a hand-drawn ring per beat, and a lens ring that tightens on each downbeat), `halftoneBloom` and `orbits` presets suit it. Lyric animations `inkStamp`, `dotDissolve` and `handwrite` write words with a second ink, break them into dots, or draw them stroke by stroke with a single-line font (`video/src/strokeData.ts`, Hershey data under its own usage terms, Latin text only; other text falls back to the normal font). Transitions are in `video/src/transitions.ts` and cameras in `Camera.tsx`.

**Flow between sections** (`video/src/timeline.ts`): each section change is moved onto the nearest downbeat (or beat) and the transition is timed so its hit (the cut, the flash, the mask closing) lands on it, about two beats long. The incoming section starts drawing a little before the beat, both sections keep moving through the change, the palette blends from one to the next, and when the music builds into a change the outgoing section leans toward the camera. How much louder the music gets across the cut scales flashes and punches. Transitions: `crossfade`, `flash`, `zoomThrough`, `iris`, `dive`, `push` (slides the old section off), `whip` (a motion-blurred pan), `wipe` (an angled edge with a band of the foreground colour) and `punch` (punches in, then bursts the new section open with a starburst and a flash on the beat).

**Movement in scenes**: one camera state drives both the abstract visuals (a flat transform) and scenes, where it becomes parallax: each scenery layer has a depth from 0 (far) to 1 (the ground line), nearer layers pan and zoom more, and everything is drawn past the frame edges so no edge ever shows. `handheld` wanders on smooth noise and gets livelier with loudness. The world scrolls past a walking or running lead at exactly their stride (the walk cycle plants each foot and solves the legs with two-bone IK, `scenes/actions.ts`), so feet don't slide. Dancing follows the detected beats rather than the tempo and changes move each bar; jumps land on the beat with a crouch before take-off; heads, arms and long hair lag the body slightly (follow-through); figures breathe, squash and stretch, and nod to loud beats; and they cast contact shadows. Trees and grass sway in the wind, lamps swell on the beat, city windows change between bars, and fireflies or dust drift in some settings. Motion amplitudes follow smoothed loudness (`smoothed` in `features.ts`), not the raw per-frame value, so nothing jitters.

**Adding a visual preset**: add it to the `VisualPreset` literal in `backend/app/models.py`, run `npm run schema`, then add the component to `video/src/presets/` and register it in `presets/index.ts` and `presets/params.ts` (both are typed against the schema, so the build fails until they're complete).

## Troubleshooting

- **`ECONNREFUSED` in the web terminal**: the backend isn't running. Use `npm run dev`.
- **`401` from a Claude step**: enter your key under **Claude API key** at the top right, or fix it there if Anthropic rejected it. Keys are per browser, so each browser needs its own. Scripted calls need the header `X-Anthropic-Key: <key>`.
- **`409 another job is in progress`**: wait for the current analysis or render to finish.
- **Scripting the API**: POST/PUT/PATCH/DELETE need the header `X-MVM-Client: web` (otherwise `403`; this blocks other websites from writing to it), and only `localhost` / `127.0.0.1` are served (otherwise `400`). The `/docs` *Try it out* buttons can't add the header, so use e.g. `curl -H 'X-MVM-Client: web'`.
- **Render fails or fonts look wrong**: the first render needs internet to fetch Chrome, and fonts load from Google Fonts. Offline, text falls back to a system font. Check `projects/<id>/out/render.log`.
- **Beats or sections look off**: downbeats assume 4/4 with the first beat on the downbeat, and sections come from audio similarity. Describe what you want per section in the Sections panel; boundaries themselves aren't editable yet.

## License

[MIT](LICENSE)
