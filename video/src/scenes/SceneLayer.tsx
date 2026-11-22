import { useMemo } from "react";
import type { AnalysisData, Lyrics, Weather } from "../../../shared/types";
import { depthTransform, type CameraState } from "../Camera";
import { mix } from "../color";
import { smoothed } from "../features";
import { wobble } from "../motion";
import { mulberry32 } from "../rng";
import { beatPeriod } from "../timeline";
import { beatPhase, beatPulse } from "../timing";
import { ENTER_STAGGER, groundSpeed, poseWithEntrance, poseFor, type ActionCtx } from "./actions";
import { crowdAction, crowdSize } from "./crowd";
import type { Mood } from "./face";
import { holdPose } from "./held";
import { Background, bleedOf } from "./backgrounds";
import { MAX_ZOOM, type Framing } from "./direction";
import { featureColor } from "./face";
import { mouthOpen } from "./lip";
import { Figure } from "./Figure";
import { FreeformBackground, FreeformFigure } from "./freeform";
import { ObjectArt } from "./objects";
import { facings, objectPlacements, PLACEMENT_X, propPlacements } from "./layout";
import type { ResolvedCharacter, ResolvedObject, ResolvedScene } from "./normalize";
import { PropShape } from "./props";
import { parseSafeSvgCached } from "./safeSvg";
import { Ambient, celestialPos, Sky, WeatherOverlay } from "./sky";
import { driftColors, lightingAt } from "./lighting";
import { LensFlare, LightPulse } from "./LightFx";

type Props = {
  uid: string;
  scene: ResolvedScene;
  cast: ResolvedCharacter[];
  objects: ResolvedObject[];
  t: number;
  width: number;
  height: number;
  analysis: AnalysisData;
  palette: string[];
  seed: number;
  /** false in "both" mode, so the abstract visuals show through where the sky would be. */
  showSky: boolean;
  cam: CameraState;
  /** The lead character mouths these words. */
  lyrics: Lyrics | null;
  /** Where the shot looks and how close; the section's own camera motion is applied on top. */
  framing?: Framing;
  /** When this scene appears; its cast eases into their actions from then. */
  enterAt?: number;
  /** 0..1 through the section, for the light's drift. */
  sectionProgress?: number;
  /** The section's intensity, 0..1: how lively the crowd is and whether one turns up on its own. */
  intensity?: number;
  /** Whether the renderer may add a crowd to a scene that doesn't set one. */
  autoCrowd?: boolean;
  /** What the lyrics call for the lead's face right now, and how strongly the music shows it. */
  leadMood?: Mood | null;
  expressStrength?: number;
};

const WIND: Record<Weather, number> = { clear: 0.15, fog: 0.05, rain: 0.6, snow: 0.4 };
// A drawn backdrop has no layers to move apart, so it is enlarged about the ground line to keep its edges hidden.
const BACKDROP_OVERSCAN = 1.1;

/** x wrapped into the frame plus a margin, so scenery that scrolls off one side comes back on the other. */
const wrapX = (x: number, w: number, margin: number) => {
  const span = w + 2 * margin;
  return ((((x + margin) % span) + span) % span) - margin;
};

export const SceneLayer = ({ uid, scene, cast, objects, t, width: w, height: h, analysis, palette, seed, showSky, cam, lyrics, framing, enterAt, sectionProgress = 0, intensity = 0.5, autoCrowd = true, leadMood = null, expressStrength = 1 }: Props) => {
  // The light slowly moves on toward the next time of day over the section.
  const c = driftColors(palette, scene.time_of_day, sectionProgress);
  const portrait = h > w;
  // A free-form backdrop is drawn with its ground line at 77% of the height in every aspect ratio (it is cropped, not squeezed).
  const backdrop = scene.illustration === "freeform" && scene.background_svg ? parseSafeSvgCached(scene.background_svg) : null;
  const gy = h * (backdrop ? 0.77 : portrait ? 0.74 : 0.77);
  const hz = h * (portrait ? 0.5 : 0.56);
  const unit = Math.min(h * 0.44, w * 0.52);
  const bleed = bleedOf(w, h);
  const energy = smoothed(analysis, "rms", t);
  const beatLen = beatPeriod(analysis);
  const beat = beatPhase(analysis.beats, t, analysis.bpm);
  const pulse = beatPulse(analysis.beats, t);
  const wind = Math.min(1, WIND[scene.weather] + 0.25 * energy);
  // The music's own light: a lift on each beat (more on a downbeat), a flare when something hits hard, and a rim on the cast.
  const light = lightingAt(scene.time_of_day, pulse, beatPulse(analysis.downbeats, t, 0.35), smoothed(analysis, "onset_strength", t), energy);
  const sun = celestialPos(scene.time_of_day, w, hz);
  const ctx = (ft: number, variant: number): ActionCtx => ({ t: ft, beat, beatLen, energy, seed, variant });

  // Someone who looks at another character turns to face them.
  const faces = facings(scene);
  const members = scene.characters.flatMap((sc, k) => {
    const ch = cast.find((x) => x.id === sc.character_id);
    return ch ? [{ sc, ch, facing: faces[k] }] : [];
  });
  const lead = members[0];
  // The world scrolls past a walking lead at exactly their stride, so planted feet don't slide on the ground.
  const leadSize = unit * (lead?.ch.build ?? 1);
  const speed = lead ? groundSpeed(lead.sc.action) * leadSize * (lead.facing === "left" ? -1 : 1) : 0;
  const travel = speed * t;

  const focus = framing ? { x: framing.aim.x * w, y: gy - framing.aim.h * leadSize } : { x: lead ? PLACEMENT_X[lead.sc.placement] * w : w / 2, y: gy - unit * 0.45 };
  const camera = framing ? { ...cam, zoom: Math.min(cam.zoom * framing.zoom, MAX_ZOOM) } : cam;
  const layer = (depth: number) => depthTransform(camera, depth, w, h, focus);
  const ground = layer(1);

  const crowdCount = crowdSize(scene.crowd, intensity, lead?.sc.action, autoCrowd);
  const crowd = useMemo(() => {
    const rand = mulberry32(seed ^ 0xc2b2ae35);
    return Array.from({ length: crowdCount }, (_, i) => ({
      x0: ((i + 0.5) / Math.max(crowdCount, 1) + (rand() - 0.5) * 0.08) * w,
      depth: rand(),
      walks: rand() < 0.5,
      dir: rand() < 0.5 ? 1 : -1,
      offset: rand() * 5,
      pick: rand(),
      hair: (["none", "short", "hat", "long", "hood"] as const)[Math.floor(rand() * 5)],
      hat: ([null, null, "cowboy", "beanie", "cap", "top_hat", "beret", "sun_hat"] as const)[Math.floor(rand() * 8)],
    }));
  }, [crowdCount, seed, w]);

  return (
    <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
      {backdrop ? (
        <g transform={ground}>
          <g transform={`translate(${w / 2} ${gy}) scale(${BACKDROP_OVERSCAN}) translate(${-w / 2} ${-gy})`}>
            <FreeformBackground art={backdrop} uid={`${uid}-bg`} w={w} h={h} />
          </g>
        </g>
      ) : (
        <>
          {showSky && (
            <g transform={layer(0.03)}>
              <Sky uid={uid} w={w} h={h} hz={hz} t={t} c={c} seed={seed} bleed={bleed} />
            </g>
          )}
          <Background uid={uid} setting={scene.setting} w={w} h={h} gy={gy} hz={hz} t={t} travel={travel} c={c} seed={seed} layer={layer} bar={Math.floor(beat / 4)} wind={wind} />
        </>
      )}

      <g transform={layer(0.9)}>
        <Ambient setting={scene.setting} time={scene.time_of_day} weather={scene.weather} w={w} gy={gy} hz={hz} t={t} c={c} seed={seed} pulse={pulse} />
      </g>

      {crowd.map((p, i) => {
        // Further-back people are smaller, stand higher up the ground, and move less with the camera and the world.
        const depth = 0.35 + 0.5 * p.depth;
        const size = unit * (0.42 + 0.34 * p.depth);
        const y = hz + (gy - hz) * depth;
        // They follow the music: calm sections stroll and stand, lively ones sway, cheer and jump.
        const action = crowdAction(intensity, p.pick, p.walks);
        const own = action === "walk" ? p.dir * groundSpeed("walk") * size : 0;
        const x = wrapX(p.x0 + own * t - travel * depth, w, size * 0.4);
        // Those who aren't walking turn toward the lead.
        const toward = lead && PLACEMENT_X[lead.sc.placement] * w > x ? "right" : "left";
        return (
          <g key={i} transform={layer(depth)}>
            <Figure
              pose={poseFor(action, ctx(t + p.offset, 10 + i))}
              colors={cast[0]?.colors ?? { body: c.ink, hair: c.ink, top: c.ink, bottom: c.ink, accent: c.ink }}
              hair={p.hair}
              hat={p.hat ?? undefined}
              outfit="tee"
              x={x}
              y={y}
              size={size}
              facing={action === "walk" ? (p.dir > 0 ? "right" : "left") : toward}
              mono={c.ink}
              opacity={0.9}
              shadow={c.ink}
            />
          </g>
        );
      })}

      <g transform={ground}>
        {propPlacements(scene)
          // The drawn backdrop already contains its own scenery; only the seat for a sitting character is still added.
          .filter((p) => !backdrop || p.kind === "bench")
          .map((p, i) => (
            <PropShape
              key={`${p.kind}-${i}`}
              kind={p.kind}
              x={p.seat ? p.x * w : wrapX(p.x * w - travel, w, unit * 0.4)}
              gy={gy}
              unit={unit}
              c={c}
              t={t}
              pulse={pulse}
              sway={wobble(seed, t + i * 1.7, 40, 0.3) * (0.8 + 2.5 * wind)}
            />
          ))}

        {objectPlacements(scene, objects).map((o, i) => {
          const art = parseSafeSvgCached(o.svg);
          return art ? <ObjectArt key={`${o.id}-${i}`} art={art} uid={`${uid}-o${i}`} x={wrapX(o.x * w - travel, w, unit * o.scale)} y={gy} size={unit * o.scale} /> : null;
        })}

        {members.map(({ sc, ch, facing }, i) => {
          const ft = t + i * 0.43;
          const acting = enterAt === undefined ? poseFor(sc.action, ctx(ft, i)) : poseWithEntrance(sc.action, ctx(ft, i), t - enterAt - i * ENTER_STAGGER);
          // What they hold takes over the arms it needs; the other arm keeps doing what the action does.
          const pose = sc.holding ? holdPose(acting, sc.holding, { t: ft, beat, energy }) : acting;
          const art = scene.illustration === "freeform" && ch.svg ? parseSafeSvgCached(ch.svg) : null;
          const x = PLACEMENT_X[sc.placement] * w;
          // A character without usable art is drawn with the library rig instead of disappearing.
          return art ? (
            <FreeformFigure key={`${ch.id}-${i}`} art={art} uid={`${uid}-c${i}`} pose={pose} action={sc.action} t={ft} beat={beat} x={x} y={gy} size={unit * ch.build} facing={facing} mood={sc.expression} faceColor={featureColor(ch.colors.body)} shadow={c.ink} />
          ) : (
            <Figure key={`${ch.id}-${i}`} pose={pose} colors={ch.colors} hair={ch.hair} outfit={ch.outfit} hat={ch.hat ?? undefined} accessories={ch.accessories} gender={ch.gender} rim={light.rim > 0.03 ? { color: mix(c.light, "#ffffff", 0.35), strength: light.rim, id: `${uid}-rim${i}` } : undefined} held={sc.holding ?? undefined} gaze={sc.lookAt === "camera" ? "camera" : undefined} t={ft} x={x} y={gy} size={unit * ch.build} facing={facing} face={{ mood: i === 0 && leadMood ? leadMood : sc.expression, t: ft, open: i === 0 ? mouthOpen(lyrics, t) : 0, strength: expressStrength }} shadow={c.ink} />
          );
        })}
      </g>

      <LightPulse w={w} h={h} color={c.light} amount={light.flash} />
      <LensFlare uid={uid} w={w} h={h} x={sun.x} y={sun.y} amount={light.flare} color={mix(c.celestial, "#ffffff", 0.5)} t={t} time={scene.time_of_day} />
      <WeatherOverlay uid={uid} weather={scene.weather} w={w} h={h} t={t} c={c} seed={seed} />
    </svg>
  );
};
