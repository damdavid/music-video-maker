import { useMemo, type ReactNode } from "react";
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from "remotion";
import type { AnalysisData, Lyrics, Meta, Settings, Storyboard, StylePlan, StyleSection } from "../../shared/types";
import { Camera, cameraState, type CameraState } from "./Camera";
import { background, foreground, mixPalettes, safePalette, shiftPalette } from "./color";
import { easeInOutCubic } from "./easing";
import { fallbackPlan } from "./fallbackPlan";
import { seriesFrame, smoothed } from "./features";
import { smooth } from "./motion";
import { Grain, Vignette } from "./Overlays";
import { RisoRegistration, RisoTexture } from "./riso/RisoFinish";
import { PRESETS } from "./presets";
import { resolveParams } from "./presets/params";
import { hashString } from "./rng";
import { buildTimeline } from "./timeline";
import { beatPulse, clamp, visibleLines } from "./timing";
import { transitionLayout } from "./transitions";
import { LyricLayer, LyricScrim } from "./LyricLayer";
import { resolveCharacter, resolveObject, resolveScene, type ResolvedScene } from "./scenes/normalize";
import { SceneLayer } from "./scenes/SceneLayer";
import { TitleCard } from "./TitleCard";
import { useGoogleFont } from "./useGoogleFont";

export type MusicVideoProps = {
  analysis: AnalysisData;
  lyrics: Lyrics | null;
  plan: StylePlan | null;
  storyboard: Storyboard | null;
  meta: Meta;
  settings: Settings;
  audioSrc: string;
};

/** How much a section swells toward the camera while the music builds into the next one. */
const BUILD_ZOOM = 0.06;
const WHIP_FILTER = "mvm-whip";

type ResolvedSection = {
  style: StyleSection;
  palette: string[];
  params: Record<string, number>;
  scene: ResolvedScene | null;
};

export const MusicVideo = ({ analysis, lyrics, plan: planProp, storyboard, meta, settings, audioSrc }: MusicVideoProps) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const mode = settings.visual_mode ?? "abstract";

  // Everything that depends only on the props, worked out once instead of on every frame.
  const { plan, sections, timeline, cast, objects, seed, fontText } = useMemo(() => {
    const plan = planProp ?? fallbackPlan(analysis);
    const fallback = fallbackPlan(analysis);
    const globalPalette = safePalette(plan.global.palette, fallback.global.palette);
    const styleFor = (i: number): StyleSection =>
      plan.sections.find((s) => s.section_ref === i) ?? plan.sections[Math.min(i, plan.sections.length - 1)] ?? fallback.sections[0] ?? fallbackPlan({ ...analysis, sections: [{ start: 0, end: analysis.duration, label: "all" }] }).sections[0];
    const count = Math.max(1, analysis.sections.length);
    const sections: ResolvedSection[] = Array.from({ length: count }, (_, i) => {
      const style = styleFor(i);
      const sceneData = mode === "abstract" ? undefined : storyboard?.scenes?.find((sc) => sc.section_ref === i);
      return {
        style,
        palette: shiftPalette(safePalette(style.palette_override, globalPalette), style.palette_shift ?? 0),
        params: resolveParams(style.visual_preset, style.preset_params),
        scene: sceneData ? resolveScene(sceneData, storyboard?.illustration ?? "library") : null,
      };
    });
    const timed = analysis.sections.length ? analysis : { ...analysis, sections: [{ start: 0, end: analysis.duration, label: "all" }] };
    return {
      plan,
      sections,
      timeline: buildTimeline(timed, (i) => sections[i].style.transition_in ?? "crossfade"),
      cast: (storyboard?.cast ?? []).map(resolveCharacter),
      objects: (storyboard?.objects ?? []).map(resolveObject),
      seed: hashString(`${meta.title}|${meta.artist}|${analysis.duration}`),
      fontText: [meta.title, meta.artist, ...(lyrics?.lines ?? []).map((l) => l.text)].join(" "),
    };
  }, [analysis, planProp, storyboard, mode, meta.title, meta.artist, lyrics]);

  const fontFamily = useGoogleFont(plan.global.font_family, fontText);
  const bounds = analysis.sections;
  const pulse = beatPulse(analysis.beats, t);
  const energy = smoothed(analysis, "rms", t);
  const idx = timeline.sectionAt(t);
  const boundary = timeline.boundaries[idx];
  const inTransition = idx > 0 && t < boundary.end;
  const p = inTransition ? clamp((t - boundary.start) / Math.max(boundary.end - boundary.start, 1e-3)) : 1;
  // Colours move from the old section's palette to the new one over the change instead of switching on a frame.
  const palette = inTransition ? mixPalettes(sections[idx - 1].palette, sections[idx].palette, easeInOutCubic(p)) : sections[idx].palette;

  const camFor = (i: number): CameraState => {
    const s = sections[i].style;
    const sec = bounds[i];
    const cam = cameraState(s.camera_motion ?? "none", {
      t,
      progress: sec ? clamp((t - sec.start) / Math.max(sec.end - sec.start, 0.001)) : 0,
      pulse,
      intensity: s.intensity,
      energy,
      seed,
    });
    // Leaning in while the music builds into the next section, and held through the change so it doesn't snap back.
    const next = timeline.boundaries[i + 1];
    if (!next || next.build <= 0) return cam;
    const k = smooth((t - next.buildFrom) / Math.max(next.start - next.buildFrom, 1e-3));
    return { ...cam, zoom: cam.zoom * (1 + BUILD_ZOOM * next.build * k) };
  };

  const layer = (i: number) => {
    const { style: s, palette: pal, params, scene } = sections[i];
    const Preset = PRESETS[s.visual_preset];
    const motion = s.camera_motion ?? "none";
    const cam = camFor(i);
    // A section with no scene falls back to the abstract visuals rather than rendering blank.
    const showAbstract = mode !== "scenes" || !scene;
    return (
      <>
        {showAbstract && (
          <Camera motion={motion === "none" && cam.zoom !== 1 ? "slowZoom" : motion} state={cam}>
            <Preset uid={`p${i}`} frame={seriesFrame(analysis, t)} t={t} width={width} height={height} analysis={analysis} palette={pal} intensity={s.intensity} seed={seed} params={params} />
          </Camera>
        )}
        {scene && <SceneLayer uid={`sc${i}`} scene={scene} cast={cast} objects={objects} t={t} width={width} height={height} analysis={analysis} palette={pal} seed={seed} showSky={mode === "scenes"} cam={cam} />}
      </>
    );
  };

  const riso = (plan.global.look ?? "clean") === "riso";
  const layout = inTransition ? transitionLayout(boundary.kind, p, width, height, { dir: boundary.dir, strength: boundary.strength }) : null;

  const incoming = (
    <AbsoluteFill style={layout?.incoming}>
      {layout?.incomingInner ? <AbsoluteFill style={layout.incomingInner}>{layer(idx)}</AbsoluteFill> : layer(idx)}
    </AbsoluteFill>
  );
  const outgoing = layout?.showOutgoing ? <AbsoluteFill style={layout.outgoing}>{layer(idx - 1)}</AbsoluteFill> : null;
  const blur = layout?.blur ?? 0;

  const stack: ReactNode =
    layout?.incomingOnTop === false ? (
      <>
        {incoming}
        {outgoing}
      </>
    ) : (
      <>
        {outgoing}
        {incoming}
      </>
    );
  const visuals = (
    <>
      {blur > 0.5 ? (
        <>
          <svg width={0} height={0} style={{ position: "absolute" }}>
            <filter id={WHIP_FILTER} x="-5%" y="0" width="110%" height="100%">
              <feGaussianBlur stdDeviation={`${blur.toFixed(1)} 0`} edgeMode="duplicate" />
            </filter>
          </svg>
          <AbsoluteFill style={{ filter: `url(#${WHIP_FILTER})` }}>{stack}</AbsoluteFill>
        </>
      ) : (
        stack
      )}
      {layout?.edge && <AbsoluteFill style={{ ...layout.edge, backgroundColor: foreground(palette) }} />}
      {layout && layout.flash > 0 && <AbsoluteFill style={{ backgroundColor: foreground(palette), opacity: layout.flash }} />}
    </>
  );

  const showLyrics = settings.lyric_video !== false && !!lyrics;
  const lineSection = (k: number) => sections[timeline.musicalSectionAt(lyrics!.lines[k].start)] ?? sections[idx];
  const lines = showLyrics ? visibleLines(lyrics!, t, (k) => (lineSection(k).style.lyric_animation ?? "pop") !== "dotDissolve") : [];

  return (
    <AbsoluteFill style={{ backgroundColor: background(palette), overflow: "hidden" }}>
      {riso ? (
        <RisoRegistration unit={Math.min(width, height)} seed={seed}>
          {visuals}
        </RisoRegistration>
      ) : (
        visuals
      )}

      {riso ? (
        // Print texture is fixed to the page; the film-style vignette and flickering grain don't belong to it.
        <RisoTexture width={width} height={height} seed={seed} strength={0.5 + (plan.global.grain ?? 0)} />
      ) : (
        <>
          <Vignette amount={plan.global.vignette ?? 0} />
          <Grain amount={plan.global.grain ?? 0} frame={frame} width={width} height={height} />
        </>
      )}

      {lines.length > 0 && <LyricScrim palette={lineSection(lines[lines.length - 1].index).palette} opacity={Math.max(...lines.map((l) => l.opacity))} />}
      {lines.map((l) => {
        const sec = lineSection(l.index);
        return (
          <LyricLayer
            key={l.index}
            line={lyrics!.lines[l.index]}
            mode={sec.style.lyric_animation ?? "pop"}
            plan={plan}
            palette={sec.palette}
            beats={analysis.beats}
            fontFamily={fontFamily}
            t={t}
            seed={seed}
            opacity={l.opacity}
            exit={l.exit}
          />
        );
      })}
      {!showLyrics && <TitleCard meta={meta} t={t} duration={durationInFrames / fps} palette={palette} fontFamily={fontFamily} handwritten={riso} />}
      {audioSrc && <Audio src={audioSrc} />}
    </AbsoluteFill>
  );
};

