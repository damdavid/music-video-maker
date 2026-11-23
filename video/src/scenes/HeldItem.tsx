import type { CharacterColors } from "../../../shared/types";
import type { HeldKind } from "./normalize";
import { SEG, type Joints, type Pt } from "./rig";
import { shade } from "./shade";

// Everything is in figure heights, in the same space as Figure (up is negative y, forward is +x).
const OW = 0.0065;

type Style = { stroke: string; strokeWidth: number; strokeLinejoin: "round"; paintOrder: "stroke" };
const style = (ink: string, flat: boolean): Style => ({ stroke: flat ? "none" : ink, strokeWidth: 2 * OW, strokeLinejoin: "round", paintOrder: "stroke" });

const f = (n: number) => n.toFixed(4);
const deg = (r: number) => (r * 180) / Math.PI;
const unit = (a: Pt, b: Pt): Pt => {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

type HandProps = { kind: Exclude<HeldKind, "guitar">; j: Joints; colors: CharacterColors; ink: string; flat: boolean; t: number; swing: number };

/** Items held in the near hand. Drawn behind the hand, so the fingers close round them. */
export const HeldInHand = ({ kind, j, colors, ink, flat, t, swing }: HandProps) => {
  const H = j.handR;
  const st = style(ink, flat);
  const accent = colors.accent;
  const dark = shade(colors.bottom, -20);
  switch (kind) {
    case "umbrella": {
      // The canopy rides over the head, tilted back from the hand, so the shaft leans across the figure.
      const top: Pt = { x: j.head.x + 0.01, y: j.head.y - SEG.headR - 0.085 };
      const d = unit(H, top);
      const lower: Pt = { x: H.x - d.x * 0.11, y: H.y - d.y * 0.11 };
      const angle = deg(Math.atan2(d.y, d.x)) + 90;
      const scallop = [-0.21, -0.07, 0.07, 0.21];
      return (
        <g>
          <path d={`M ${f(lower.x)} ${f(lower.y)} L ${f(top.x)} ${f(top.y)}`} fill="none" stroke={dark} strokeWidth={0.013} strokeLinecap="round" />
          <path d={`M ${f(lower.x)} ${f(lower.y)} q ${f(-0.02 * d.y)} ${f(0.02 * d.x + 0.03)} ${f(-0.035)} ${f(0.01)}`} fill="none" stroke={dark} strokeWidth={0.011} strokeLinecap="round" />
          <g transform={`translate(${f(top.x)} ${f(top.y)}) rotate(${f(angle)})`}>
            <path
              d={`M -0.21 0 Q -0.2 -0.16 0 -0.17 Q 0.2 -0.16 0.21 0 ${scallop
                .slice()
                .reverse()
                .map((x, i) => (i === 0 ? "" : `Q ${f((x + scallop[scallop.length - i]) / 2 + 0.0)} 0.04 ${f(x)} 0`))
                .join(" ")} Z`}
              fill={accent}
              {...st}
            />
            {!flat && <path d="M -0.21 0 Q -0.2 -0.16 0 -0.17 L 0 0 Z" fill={shade(accent, -14)} />}
            {!flat && [-0.1, 0.1].map((x) => <path key={x} d={`M 0 -0.17 Q ${x * 1.1} -0.1 ${x} 0`} fill="none" stroke={shade(accent, -22)} strokeWidth={0.005} />)}
            <circle cx={0} cy={-0.172} r={0.012} fill={dark} />
          </g>
        </g>
      );
    }
    case "suitcase": {
      return (
        <g transform={`rotate(${f(-swing)} ${f(H.x)} ${f(H.y)})`}>
          <path d={`M ${f(H.x - 0.032)} ${f(H.y + 0.09)} L ${f(H.x - 0.032)} ${f(H.y + 0.045)} Q ${f(H.x)} ${f(H.y + 0.025)} ${f(H.x + 0.032)} ${f(H.y + 0.045)} L ${f(H.x + 0.032)} ${f(H.y + 0.09)}`} fill="none" stroke={dark} strokeWidth={0.012} strokeLinecap="round" />
          <rect x={H.x - 0.085} y={H.y + 0.085} width={0.17} height={0.125} rx={0.014} fill={accent} {...st} />
          {!flat && (
            <g fill="none" stroke={shade(accent, -22)} strokeWidth={0.006} strokeLinecap="round">
              <path d={`M ${f(H.x - 0.085)} ${f(H.y + 0.135)} H ${f(H.x + 0.085)}`} />
              <path d={`M ${f(H.x - 0.05)} ${f(H.y + 0.085)} V ${f(H.y + 0.21)} M ${f(H.x + 0.05)} ${f(H.y + 0.085)} V ${f(H.y + 0.21)}`} />
            </g>
          )}
          {!flat && <rect x={H.x - 0.012} y={H.y + 0.15} width={0.024} height={0.018} rx={0.004} fill={shade(accent, 24)} />}
        </g>
      );
    }
    case "microphone": {
      const d = unit(j.elbowR, H);
      const head: Pt = { x: H.x + d.x * 0.083, y: H.y + d.y * 0.083 };
      return (
        <g>
          <path d={`M ${f(H.x - d.x * 0.02)} ${f(H.y - d.y * 0.02)} Q ${f(H.x + 0.05)} ${f(H.y + 0.22)} ${f(H.x - 0.03)} ${f(H.y + 0.4)}`} fill="none" stroke={dark} strokeWidth={0.006} strokeLinecap="round" />
          <path d={`M ${f(H.x - d.x * 0.03)} ${f(H.y - d.y * 0.03)} L ${f(H.x + d.x * 0.065)} ${f(H.y + d.y * 0.065)}`} stroke={shade("#9aa0a8", -10)} strokeWidth={0.03} strokeLinecap="round" />
          <circle cx={head.x} cy={head.y} r={0.029} fill="#b6bcc4" {...st} />
          {!flat && <path d={`M ${f(head.x - 0.024)} ${f(head.y)} H ${f(head.x + 0.024)} M ${f(head.x)} ${f(head.y - 0.024)} V ${f(head.y + 0.024)}`} stroke="#7d848c" strokeWidth={0.004} />}
        </g>
      );
    }
    case "flowers": {
      const top: Pt = { x: H.x + 0.035, y: H.y - 0.15 };
      const heads: [number, number, string][] = [[-0.045, 0.02, accent], [0.0, -0.025, shade(accent, 18)], [0.048, 0.012, shade(colors.top, 10)]];
      return (
        <g>
          {heads.map(([dx], i) => (
            <path key={i} d={`M ${f(H.x)} ${f(H.y)} L ${f(top.x + dx)} ${f(top.y + heads[i][1])}`} stroke="#3f7a3a" strokeWidth={0.008} strokeLinecap="round" />
          ))}
          <path d={`M ${f(H.x - 0.04)} ${f(H.y - 0.07)} L ${f(H.x + 0.05)} ${f(H.y - 0.07)} L ${f(H.x)} ${f(H.y + 0.03)} Z`} fill="#f2e9d0" {...st} />
          {heads.map(([dx, dy, col], i) => (
            <g key={`h${i}`} transform={`translate(${f(top.x + dx)} ${f(top.y + dy)})`}>
              {[0, 72, 144, 216, 288].map((a) => (
                <circle key={a} cx={0.022 * Math.cos((a * Math.PI) / 180)} cy={0.022 * Math.sin((a * Math.PI) / 180)} r={0.018} fill={col} {...st} />
              ))}
              <circle r={0.012} fill="#f1c40f" />
            </g>
          ))}
        </g>
      );
    }
    case "lantern": {
      const angle = 5 * Math.sin(t * 1.7);
      const warm = "#ffcf7a";
      return (
        <g transform={`rotate(${f(angle)} ${f(H.x)} ${f(H.y)})`}>
          {!flat && [0.17, 0.12, 0.075].map((r, i) => <circle key={r} cx={H.x} cy={H.y + 0.16} r={r} fill={warm} opacity={0.1 + 0.07 * i} />)}
          <path d={`M ${f(H.x)} ${f(H.y)} L ${f(H.x)} ${f(H.y + 0.07)}`} stroke={dark} strokeWidth={0.008} strokeLinecap="round" />
          <rect x={H.x - 0.04} y={H.y + 0.065} width={0.08} height={0.016} rx={0.006} fill={dark} {...st} />
          <rect x={H.x - 0.033} y={H.y + 0.08} width={0.066} height={0.085} rx={0.01} fill={warm} {...st} />
          {!flat && <path d={`M ${f(H.x - 0.033)} ${f(H.y + 0.1)} H ${f(H.x + 0.033)} M ${f(H.x)} ${f(H.y + 0.08)} V ${f(H.y + 0.165)}`} stroke={shade("#c28a2d", 0)} strokeWidth={0.004} />}
          <rect x={H.x - 0.04} y={H.y + 0.163} width={0.08} height={0.014} rx={0.006} fill={dark} {...st} />
        </g>
      );
    }
    case "phone": {
      const glow = "#bfe3ff";
      return (
        <g transform={`translate(${f(H.x + 0.012)} ${f(H.y - 0.05)}) rotate(14)`}>
          {!flat && <ellipse cx={0.012} cy={-0.02} rx={0.075} ry={0.1} fill={glow} opacity={0.14} />}
          <rect x={-0.014} y={-0.062} width={0.03} height={0.124} rx={0.008} fill={dark} {...st} />
          {!flat && <rect x={0.004} y={-0.053} width={0.009} height={0.106} rx={0.004} fill={glow} />}
        </g>
      );
    }
    case "flag": {
      // The pole stands upright from the fist; the cloth streams away from the wind of the beat.
      const top = { x: H.x + 0.01, y: H.y - 0.7 };
      const wave = (k: number) => 0.018 * Math.sin(t * 5 + k * 1.3) + 0.012 * swing * 0.05;
      const w = 0.3;
      const h = 0.17;
      const pts = Array.from({ length: 5 }, (_, i) => ({ x: top.x - (w * i) / 4, y: top.y + 0.01 + wave(i) * (i / 2) }));
      const lowerEdge = pts.map((p) => ({ x: p.x, y: p.y + h * (1 - 0.06 * Math.sin(t * 4 + p.x * 20)) })).reverse();
      return (
        <g>
          <path d={`M ${f(H.x)} ${f(H.y + 0.1)} L ${f(top.x)} ${f(top.y)}`} stroke={dark} strokeWidth={0.012} strokeLinecap="round" />
          <circle cx={top.x} cy={top.y - 0.005} r={0.011} fill={shade(accent, 20)} {...st} />
          <path d={`M ${pts.map((p) => `${f(p.x)} ${f(p.y)}`).join(" L ")} L ${lowerEdge.map((p) => `${f(p.x)} ${f(p.y)}`).join(" L ")} Z`} fill={accent} {...st} />
          {!flat && <path d={`M ${f(pts[2].x)} ${f(pts[2].y)} L ${f(lowerEdge[2].x)} ${f(lowerEdge[2].y)}`} stroke={shade(accent, -22)} strokeWidth={0.006} />}
        </g>
      );
    }
    case "shield": {
      // A round shield seen face on, strapped to the forearm: a rim, a ring, a boss and a bold cross, in the character's metal.
      const C = { x: H.x + 0.065, y: H.y - 0.02 };
      const rim = shade(accent, -24);
      return (
        <g>
          <circle cx={C.x} cy={C.y} r={0.17} fill={accent} {...st} />
          {!flat && <circle cx={C.x} cy={C.y} r={0.146} fill="none" stroke={rim} strokeWidth={0.012} />}
          {!flat && <path d={`M ${f(C.x - 0.15)} ${f(C.y)} H ${f(C.x + 0.15)} M ${f(C.x)} ${f(C.y - 0.126)} V ${f(C.y + 0.126)}`} stroke={rim} strokeWidth={0.014} strokeLinecap="round" />}
          {!flat && <path d={`M ${f(C.x - 0.13)} ${f(C.y - 0.09)} A 0.16 0.16 0 0 1 ${f(C.x + 0.02)} ${f(C.y - 0.16)}`} fill="none" stroke="#ffffff" strokeWidth={0.008} opacity={0.5} strokeLinecap="round" />}
          <circle cx={C.x} cy={C.y} r={0.042} fill={shade(accent, 18)} {...st} />
          {!flat && <circle cx={C.x - 0.012} cy={C.y - 0.014} r={0.014} fill="#ffffff" opacity={0.55} />}
        </g>
      );
    }
    case "sword": {
      // A sword held point up in the fist, leaning a little forward: a crossguard, a grip, a pommel and a bright blade.
      const gold = "#d9b24a";
      const steel = "#d3d9e2";
      return (
        <g transform={`translate(${f(H.x)} ${f(H.y)}) rotate(9)`}>
          <path d="M -0.014 -0.08 L 0.014 -0.08 L 0.011 -0.6 L 0 -0.65 L -0.011 -0.6 Z" fill={steel} {...st} />
          {!flat && <path d="M -0.003 -0.09 L -0.003 -0.58 L 0.003 -0.58 L 0.003 -0.09 Z" fill={shade(steel, -14)} />}
          {!flat && <path d="M 0.009 -0.1 L 0.008 -0.58" stroke="#ffffff" strokeWidth={0.003} opacity={0.7} />}
          <rect x={-0.056} y={-0.092} width={0.112} height={0.016} rx={0.006} fill={gold} {...st} />
          <rect x={-0.008} y={-0.078} width={0.016} height={0.12} rx={0.004} fill={dark} {...st} />
          <circle cx={0} cy={0.052} r={0.016} fill={gold} {...st} />
        </g>
      );
    }
    case "balloon": {
      // A string from the hand to a balloon that bobs and sways above it.
      const bob = 0.02 * Math.sin(t * 2.1);
      const sway = 0.03 * Math.sin(t * 1.3);
      const B = { x: H.x + 0.02 + sway, y: H.y - 0.42 + bob };
      return (
        <g>
          <path d={`M ${f(H.x)} ${f(H.y)} Q ${f(H.x + sway * 0.2)} ${f((H.y + B.y) / 2)} ${f(B.x)} ${f(B.y + 0.07)}`} fill="none" stroke={dark} strokeWidth={0.0035} />
          <ellipse cx={B.x} cy={B.y} rx={0.065} ry={0.08} fill={accent} {...st} />
          {!flat && <ellipse cx={B.x - 0.022} cy={B.y - 0.028} rx={0.016} ry={0.026} fill="#ffffff" opacity={0.45} />}
          <path d={`M ${f(B.x - 0.012)} ${f(B.y + 0.088)} L ${f(B.x)} ${f(B.y + 0.07)} L ${f(B.x + 0.012)} ${f(B.y + 0.088)} Z`} fill={shade(accent, -18)} {...st} />
        </g>
      );
    }
    case "cup": {
      return (
        <g>
          {!flat &&
            [0, 1].map((i) => (
              <path key={i} d={`M ${f(H.x - 0.012 + i * 0.026)} ${f(H.y - 0.05)} q 0.012 -0.026 0 -0.05 q -0.012 -0.022 0.004 -0.045`} fill="none" stroke="#ffffff" strokeWidth={0.005} strokeLinecap="round" opacity={0.32 + 0.12 * Math.sin(t * 2 + i)} />
            ))}
          <path d={`M ${f(H.x + 0.03)} ${f(H.y - 0.025)} q 0.036 0.002 0.03 0.03 q -0.004 0.024 -0.03 0.024`} fill="none" stroke={ink} strokeWidth={0.014} strokeLinecap="round" opacity={flat ? 0 : 1} />
          <path d={`M ${f(H.x + 0.03)} ${f(H.y - 0.025)} q 0.036 0.002 0.03 0.03 q -0.004 0.024 -0.03 0.024`} fill="none" stroke={accent} strokeWidth={0.007} strokeLinecap="round" />
          <path d={`M ${f(H.x - 0.036)} ${f(H.y - 0.055)} L ${f(H.x - 0.03)} ${f(H.y + 0.045)} Q ${f(H.x)} ${f(H.y + 0.06)} ${f(H.x + 0.03)} ${f(H.y + 0.045)} L ${f(H.x + 0.036)} ${f(H.y - 0.055)} Z`} fill={accent} {...st} />
          {!flat && <path d={`M ${f(H.x - 0.03)} ${f(H.y - 0.03)} H ${f(H.x + 0.03)}`} stroke={shade(accent, -22)} strokeWidth={0.005} />}
        </g>
      );
    }
    case "book": {
      // Held up to read: seen from the side, its cover and pages are a thin slab tilted toward the face.
      return (
        <g transform={`translate(${f(H.x + 0.03)} ${f(H.y - 0.085)}) rotate(16)`}>
          <rect x={-0.02} y={-0.11} width={0.042} height={0.22} rx={0.006} fill={accent} {...st} />
          {!flat && <rect x={0.008} y={-0.104} width={0.011} height={0.208} fill="#f2ecdb" />}
          {!flat && <path d="M -0.011 -0.07 H 0.004 M -0.011 -0.04 H 0.004" stroke={shade(accent, -25)} strokeWidth={0.005} />}
        </g>
      );
    }
  }
};

type GuitarProps = { j: Joints; colors: CharacterColors; ink: string; flat: boolean; skin: string };

/** A guitar slung across the body and held by both hands; drawn over the torso and under the head and near arm. */
export const GuitarOnBody = ({ j, colors, ink, flat, skin }: GuitarProps) => {
  const st = style(ink, flat);
  const wood = colors.accent;
  const G: Pt = { x: j.hip.x + 0.11, y: j.hip.y - 0.06 };
  const d = unit(G, j.handL);
  const len = Math.hypot(j.handL.x - G.x, j.handL.y - G.y) + 0.1;
  const angle = deg(Math.atan2(d.y, d.x));
  const dark = shade(colors.bottom, -25);
  return (
    <g>
      <path d={`M ${f(j.shoulder.x - 0.02)} ${f(j.shoulder.y + 0.01)} L ${f(G.x - d.x * 0.06)} ${f(G.y - d.y * 0.06)}`} stroke={dark} strokeWidth={0.014} strokeLinecap="round" />
      <g transform={`translate(${f(G.x)} ${f(G.y)}) rotate(${f(angle)})`}>
        <rect x={0.02} y={-0.014} width={len - 0.02} height={0.028} rx={0.004} fill={shade(wood, -34)} {...st} />
        {!flat && [0.1, 0.17, 0.24].filter((x) => x < len - 0.06).map((x) => <path key={x} d={`M ${x} -0.014 V 0.014`} stroke="#d8d4c8" strokeWidth={0.004} />)}
        <rect x={len - 0.005} y={-0.02} width={0.05} height={0.04} rx={0.006} fill={shade(wood, -40)} {...st} />
        <ellipse cx={-0.075} cy={0} rx={0.075} ry={0.078} fill={wood} {...st} />
        <ellipse cx={-0.005} cy={0} rx={0.05} ry={0.052} fill={wood} {...st} />
        {!flat && (
          <g>
            <circle cx={-0.04} cy={0} r={0.022} fill="#1b1411" />
            <rect x={-0.125} y={-0.02} width={0.014} height={0.04} rx={0.003} fill={shade(wood, -45)} />
            <path d={`M -0.14 0 A 0.078 0.078 0 0 1 -0.075 -0.078`} fill="none" stroke={shade(wood, 16)} strokeWidth={0.006} opacity={0.6} />
          </g>
        )}
      </g>
      <circle cx={j.handL.x} cy={j.handL.y} r={0.027} fill={skin} {...st} />
    </g>
  );
};
