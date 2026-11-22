import { useMemo, type ReactNode } from "react";
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from "remotion";
import type { AnalysisData, Lyrics, Meta, Settings, Storyboard, StylePlan, StyleSection } from "../../shared/types";
import { Camera, cameraState, type CameraState } from "./Camera";
import { background, foreground, mixPalettes, safePalette, shiftPalette } from "./color";
import { easeInOutCubic } from "./easing";
import { blendGrades, gradeFilter, gradeStrength } from "./grade";
import { cuesAt } from "./scenes/cues";
import { expressionStrength, moodAt } from "./scenes/mood";
import { fallbackPlan } from "./fallbackPlan";
import { seriesFrame, smoothed } from "./features";
import { smooth } from "./motion";
import { Grain, Vignette } from "./Overlays";
import { RisoRegistration, RisoTexture } from "./riso/RisoFinish";
import { PRESETS } from "./presets";
import { resolveParams } from "./presets/params";
import { hashString } from "./rng";
import { beatPeriod, buildTimeline } from "./timeline";
import { beatPulse, clamp, titleWindow, visibleLines } from "./timing";
import { transitionLayout } from "./transitions";
import { LyricLayer, LyricScrim } from "./LyricLayer";
import { barsPerShot, framingFor, holdFirstShot, planShots, type Shot } from "./scenes/direction";
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

/** Moments averaged per frame, and how much of a frame's time they span (0.5 is a 180° shutter). */
export const SHUTTER = {
  off: { samples: 1, open: 0 },
  light: { samples: 3, open: 0.5 },
  strong: { samples: 5, open: 0.75 },
} as const;

/** Offsets, in seconds from the frame's own time, at which a blurred frame is drawn. */
export const shutterOffsets = (setting: keyof typeof SHUTTER, fps: number): number[] => {
  const { samples, open } = SHUTTER[setting];
  if (samples < 2) return [0];
  return Array.from({ length: samples }, (_, k) => (k / (samples - 1) - 0.5) * (open / fps));
};

type ResolvedSection = {
  style: StyleSection;
  palette: string[];
  params: Record<string, number>;
  scene: ResolvedScene | null;
  /** How the lead's scene is cut into shots; empty when there is no scene. */
  shots: Shot[];
};

export const MusicVideo = ({ analysis, lyrics, plan: planProp, storyboard, meta, settings, audioSrc }: MusicVideoProps) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const mode = settings.visual_mode ?? "abstract";
  const autoCuts = settings.auto_cuts ?? true;
  const fromMusic = (settings.transitions ?? "music") === "music";

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
        shots: [],
      };
    });
    const timed = analysis.sections.length ? analysis : { ...analysis, sections: [{ start: 0, end: analysis.duration, label: "all" }] };
    const timeline = buildTimeline(timed, (i) => sections[i].style.transition_in ?? "crossfade", fromMusic);
    const seed = hashString(`${meta.title}|${meta.artist}|${analysis.duration}`);
    // Shots follow the cuts the timeline actually makes, which may sit a little off the detected section edges.
    sections.forEach((s, i) => {
      const lead = s.scene?.characters[0];
      if (!lead) return;
      const span = { start: timeline.boundaries[i].cut, end: timeline.boundaries[i + 1]?.cut ?? timed.duration };
      const shots = planShots(span, analysis.downbeats, beatPeriod(timed) * 4, barsPerShot(s.style.intensity), lead.action, seed, i);
      s.shots = autoCuts ? shots : holdFirstShot(shots);
    });
    return {
      plan,
      sections,
      timeline,
      cast: (storyboard?.cast ?? []).map(resolveCharacter),
      objects: (storyboard?.objects ?? []).map(resolveObject),
      seed,
      fontText: [meta.title, meta.artist, ...(lyrics?.lines ?? []).map((l) => l.text)].join(" "),
    };
  }, [analysis, planProp, storyboard, mode, autoCuts, fromMusic, meta.title, meta.artist, lyrics]);

  const fontFamily = useGoogleFont(plan.global.font_family, fontText);
  const bounds = analysis.sections;
  const riso = (plan.global.look ?? "clean") === "riso";
  const offsets = shutterOffsets(settings.motion_blur ?? "off", fps);

  // The picture at one moment. Motion blur draws it at several moments within the shutter and averages them.
  const pictureAt = (t: number) => {
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
      const lead = scene?.characters[0];
      const framing = lead && sections[i].shots.length ? framingFor({ t, shots: sections[i].shots, action: lead.action, placement: lead.placement, lyrics }) : undefined;
      return (
        <>
          {showAbstract && (
            <Camera motion={motion === "none" && cam.zoom !== 1 ? "slowZoom" : motion} state={cam}>
              <Preset uid={`p${i}`} frame={seriesFrame(analysis, t)} t={t} width={width} height={height} analysis={analysis} palette={pal} intensity={s.intensity} seed={seed} params={params} />
            </Camera>
          )}
          {scene && <SceneLayer uid={`sc${i}`} scene={scene} cast={cast} objects={objects} t={t} width={width} height={height} analysis={analysis} palette={pal} seed={seed} showSky={mode === "scenes"} cam={cam} lyrics={lyrics} framing={framing} enterAt={timeline.boundaries[i].start} sectionProgress={bounds[i] ? clamp((t - bounds[i].start) / Math.max(bounds[i].end - bounds[i].start, 0.001)) : 0} intensity={s.intensity} autoCrowd={settings.crowds ?? true} leadMood={moodAt(storyboard?.moods ?? [], t)} cues={cuesAt(storyboard?.cues ?? [], t)} expressStrength={expressionStrength(energy)} />}
        </>
      );
    };

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
    // The section's colour treatment, eased from the last section's through the change and pushed a little harder by loud music.
    const grade = blendGrades(inTransition ? (sections[idx - 1].style.grade ?? "none") : (sections[idx].style.grade ?? "none"), sections[idx].style.grade ?? "none", inTransition ? easeInOutCubic(p) : 1, gradeStrength(energy));
    return { visuals, palette, idx, grade };
  };

  const main = pictureAt(t);
  const { palette, idx } = main;
  // Each moment is an opaque layer of its own; stacking them at 1/1, 1/2, 1/3... gives every one an equal share.
  const picture = offsets.map((dt, k) => {
    const shot = dt === 0 ? main : pictureAt(clamp(t + dt, 0, durationInFrames / fps));
    const filter = gradeFilter(shot.grade);
    const graded = (
      <>
        {shot.visuals}
        {shot.grade.tintAmount > 0.004 && <AbsoluteFill style={{ backgroundColor: shot.grade.tint, opacity: Math.min(1, shot.grade.tintAmount * 2), mixBlendMode: "overlay" }} />}
      </>
    );
    const inner = riso ? (
      <RisoRegistration unit={Math.min(width, height)} seed={seed}>
        {graded}
      </RisoRegistration>
    ) : (
      graded
    );
    const content = filter || shot.grade.tintAmount > 0.004 ? <AbsoluteFill style={{ filter, isolation: "isolate" }}>{inner}</AbsoluteFill> : inner;
    return offsets.length === 1 ? (
      content
    ) : (
      <AbsoluteFill key={k} style={{ opacity: 1 / (k + 1), backgroundColor: background(shot.palette) }}>
        {content}
      </AbsoluteFill>
    );
  });

  const showLyrics = settings.lyric_video !== false && !!lyrics;
  // With lyrics the title holds through the intro (up to 8 s) and leaves before the first line; without them it is the 4 s open and close.
  const titleIntro = titleWindow(lyrics);
  const showTitle = (settings.title_card ?? true) && (!showLyrics || titleIntro > 0);
  const lineSection = (k: number) => sections[timeline.musicalSectionAt(lyrics!.lines[k].start)] ?? sections[idx];
  const lines = showLyrics ? visibleLines(lyrics!, t, (k) => (lineSection(k).style.lyric_animation ?? "pop") !== "dotDissolve", settings.lyric_fade ?? "gentle") : [];

  return (
    <AbsoluteFill style={{ backgroundColor: background(palette), overflow: "hidden" }}>
      {picture}

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
      {showTitle && <TitleCard meta={meta} t={t} duration={durationInFrames / fps} palette={palette} fontFamily={fontFamily} handwritten={riso} openFor={showLyrics ? titleIntro : undefined} closing={!showLyrics} />}
      {audioSrc && <Audio src={audioSrc} />}
    </AbsoluteFill>
  );
};

