import { useMemo } from "react";
import type { AnalysisData, Weather } from "../../../shared/types";
import { depthTransform, type CameraState } from "../Camera";
import { smoothed } from "../features";
import { wobble } from "../motion";
import { mulberry32 } from "../rng";
import { beatPeriod } from "../timeline";
import { beatPhase, beatPulse } from "../timing";
import { groundSpeed, poseFor, type ActionCtx } from "./actions";
import { Background, bleedOf } from "./backgrounds";
import { featureColor } from "./face";
import { Figure } from "./Figure";
import { FreeformBackground, FreeformFigure } from "./freeform";
import { ObjectArt } from "./objects";
import { objectPlacements, PLACEMENT_X, propPlacements } from "./layout";
import type { ResolvedCharacter, ResolvedObject, ResolvedScene } from "./normalize";
import { PropShape } from "./props";
import { parseSafeSvgCached } from "./safeSvg";
import { Ambient, sceneColors, Sky, WeatherOverlay } from "./sky";

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
};

const WIND: Record<Weather, number> = { clear: 0.15, fog: 0.05, rain: 0.6, snow: 0.4 };
// A drawn backdrop has no layers to move apart, so it is enlarged about the ground line to keep its edges hidden.
const BACKDROP_OVERSCAN = 1.1;

/** x wrapped into the frame plus a margin, so scenery that scrolls off one side comes back on the other. */
const wrapX = (x: number, w: number, margin: number) => {
  const span = w + 2 * margin;
  return ((((x + margin) % span) + span) % span) - margin;
};

export const SceneLayer = ({ uid, scene, cast, objects, t, width: w, height: h, analysis, palette, seed, showSky, cam }: Props) => {
  const c = sceneColors(palette, scene.time_of_day);
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
  const ctx = (ft: number, variant: number): ActionCtx => ({ t: ft, beat, beatLen, energy, seed, variant });

  const members = scene.characters.flatMap((sc) => {
    const ch = cast.find((x) => x.id === sc.character_id);
    return ch ? [{ sc, ch }] : [];
  });
  const lead = members[0];
  // The world scrolls past a walking lead at exactly their stride, so planted feet don't slide on the ground.
  const leadSize = unit * (lead?.ch.build ?? 1);
  const speed = lead ? groundSpeed(lead.sc.action) * leadSize * (lead.sc.facing === "left" ? -1 : 1) : 0;
  const travel = speed * t;

  const focus = { x: lead ? PLACEMENT_X[lead.sc.placement] * w : w / 2, y: gy - unit * 0.45 };
  const layer = (depth: number) => depthTransform(cam, depth, w, h, focus);
  const ground = layer(1);

  const crowd = useMemo(() => {
    const rand = mulberry32(seed ^ 0xc2b2ae35);
    return Array.from({ length: scene.crowd }, (_, i) => ({
      x0: ((i + 0.5) / Math.max(scene.crowd, 1) + (rand() - 0.5) * 0.08) * w,
      depth: rand(),
      walks: rand() < 0.5,
      dir: rand() < 0.5 ? 1 : -1,
      offset: rand() * 5,
      hair: (["none", "short", "hat", "long", "hood"] as const)[Math.floor(rand() * 5)],
    }));
  }, [scene.crowd, seed, w]);

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
        const own = p.walks ? p.dir * groundSpeed("walk") * size : 0;
        const x = wrapX(p.x0 + own * t - travel * depth, w, size * 0.4);
        return (
          <g key={i} transform={layer(depth)}>
            <Figure
              pose={poseFor(p.walks ? "walk" : "idle", ctx(t + p.offset, 10 + i))}
              colors={cast[0]?.colors ?? { body: c.ink, hair: c.ink, top: c.ink, bottom: c.ink, accent: c.ink }}
              hair={p.hair}
              outfit="tee"
              x={x}
              y={y}
              size={size}
              facing={p.walks ? (p.dir > 0 ? "right" : "left") : "right"}
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

        {members.map(({ sc, ch }, i) => {
          const ft = t + i * 0.43;
          const pose = poseFor(sc.action, ctx(ft, i));
          const art = scene.illustration === "freeform" && ch.svg ? parseSafeSvgCached(ch.svg) : null;
          const x = PLACEMENT_X[sc.placement] * w;
          // A character without usable art is drawn with the library rig instead of disappearing.
          return art ? (
            <FreeformFigure key={`${ch.id}-${i}`} art={art} uid={`${uid}-c${i}`} pose={pose} action={sc.action} t={ft} beat={beat} x={x} y={gy} size={unit * ch.build} facing={sc.facing} mood={sc.expression} faceColor={featureColor(ch.colors.body)} shadow={c.ink} />
          ) : (
            <Figure key={`${ch.id}-${i}`} pose={pose} colors={ch.colors} hair={ch.hair} outfit={ch.outfit} x={x} y={gy} size={unit * ch.build} facing={sc.facing} face={{ mood: sc.expression, t: ft }} shadow={c.ink} />
          );
        })}
      </g>

      <WeatherOverlay uid={uid} weather={scene.weather} w={w} h={h} t={t} c={c} seed={seed} />
    </svg>
  );
};
