import type { CharacterColors } from "../../../shared/types";
import type { Accessory, Hat, Outfit } from "./normalize";
import type { Joints, Pt } from "./rig";
import { shade } from "./shade";

const OW = 0.0065;
const f = (n: number) => n.toFixed(4);

/** Outfits whose sleeves cover the arms. */
export const LONG_SLEEVED: readonly Outfit[] = ["coat", "hoodie", "jacket", "suit", "robe"];

type HatProps = { hat: Hat; colors: CharacterColors; ink: string; flat: boolean; r: number };

/**
 * A hat in head space (the head is a unit circle at the origin, the face toward +x, up is negative y). It sits on the
 * hair, so the hair shows beneath it.
 */
export const HatShape = ({ hat, colors, ink, flat, r }: HatProps) => {
  const main = colors.accent;
  const band = shade(main, -26);
  const edge = { stroke: flat ? "none" : ink, strokeWidth: (2 * OW) / r, strokeLinejoin: "round", paintOrder: "stroke" } as const;
  const lit = shade(main, 14);
  switch (hat) {
    case "cowboy":
      return (
        <g {...edge}>
          <path d="M -0.9 -0.6 C -0.98 -1.3 -0.62 -1.62 -0.22 -1.52 Q 0 -1.36 0.22 -1.52 C 0.62 -1.62 0.98 -1.3 0.9 -0.6 Z" fill={main} />
          <path d="M -2.15 -1.0 Q -1.25 -0.38 0 -0.46 Q 1.25 -0.38 2.15 -1.0 Q 1.3 -0.72 0 -0.74 Q -1.3 -0.72 -2.15 -1.0 Z" fill={main} />
          {!flat && <path d="M -0.9 -0.68 Q 0 -0.6 0.9 -0.68 L 0.89 -0.82 Q 0 -0.74 -0.89 -0.82 Z" fill={band} stroke="none" />}
          {!flat && <path d="M -0.55 -1.35 Q -0.3 -1.5 -0.12 -1.45" fill="none" stroke={lit} strokeWidth={0.07} strokeLinecap="round" />}
        </g>
      );
    case "beanie":
      return (
        <g {...edge}>
          <path d="M -1.08 -0.42 C -1.2 -1.7 1.2 -1.7 1.08 -0.42 Z" fill={main} />
          <rect x={-1.12} y={-0.7} width={2.24} height={0.34} rx={0.14} fill={band} />
          <circle cx={0} cy={-1.5} r={0.22} fill={lit} />
          {!flat && [-0.6, -0.2, 0.2, 0.6].map((x) => <path key={x} d={`M ${x} -0.7 L ${x * 0.8} -1.4`} stroke={band} strokeWidth={0.05} fill="none" />)}
        </g>
      );
    case "cap":
      return (
        <g {...edge}>
          <path d="M -1.04 -0.46 C -1.08 -1.55 0.98 -1.6 1.06 -0.46 Z" fill={main} />
          <path d="M 0.72 -0.66 Q 1.65 -0.74 1.92 -0.5 Q 1.4 -0.42 0.72 -0.46 Z" fill={band} />
          <circle cx={-0.02} cy={-1.5} r={0.08} fill={band} />
          {!flat && <path d="M -0.02 -1.46 L 0.05 -0.62" stroke={band} strokeWidth={0.04} fill="none" />}
        </g>
      );
    case "top_hat":
      return (
        <g {...edge}>
          <rect x={-0.82} y={-2.4} width={1.64} height={1.82} rx={0.07} fill={shade(main, -34)} />
          <ellipse cx={0} cy={-0.58} rx={1.45} ry={0.2} fill={shade(main, -34)} />
          <rect x={-0.82} y={-1.0} width={1.64} height={0.3} fill={main} />
          {!flat && <path d="M -0.55 -2.25 L -0.55 -1.15" stroke={shade(main, -12)} strokeWidth={0.1} strokeLinecap="round" fill="none" />}
        </g>
      );
    case "beret":
      return (
        <g {...edge}>
          <ellipse cx={-0.1} cy={-1.02} rx={1.4} ry={0.5} transform="rotate(-9 -0.1 -1.02)" fill={main} />
          <circle cx={-0.35} cy={-1.52} r={0.1} fill={band} />
          {!flat && <path d="M -0.9 -0.85 Q 0 -0.62 1.05 -0.9" stroke={band} strokeWidth={0.06} fill="none" />}
        </g>
      );
    case "sun_hat":
      return (
        <g {...edge}>
          <path d="M -0.95 -0.6 C -1.0 -1.4 0.95 -1.45 0.98 -0.6 Z" fill={main} />
          <ellipse cx={0} cy={-0.56} rx={2.3} ry={0.34} fill={lit} />
          <rect x={-0.96} y={-0.88} width={1.94} height={0.22} fill={band} />
          {!flat && <path d="M -0.2 -0.88 q -0.5 0.4 -0.8 0.55" stroke={band} strokeWidth={0.07} fill="none" strokeLinecap="round" />}
        </g>
      );
  }
};

type FaceGearProps = { accessories: Accessory[]; colors: CharacterColors; ink: string; flat: boolean; r: number; frontal: boolean; faceCx: number };

/** Glasses and headphones, in head space (see HatShape). */
export const HeadGear = ({ accessories, colors, ink, flat, r, frontal, faceCx }: FaceGearProps) => {
  if (flat) return null;
  const spread = frontal ? 0.3 : 0.22;
  const eyes = [faceCx - spread, faceCx + spread];
  const line = { stroke: ink, strokeWidth: 0.07, strokeLinecap: "round", fill: "none" } as const;
  return (
    <g>
      {accessories.includes("headphones") && (
        <g>
          <path d="M -0.78 0.22 C -1.1 -1.0 0.9 -1.5 1.0 -0.1" fill="none" stroke={ink} strokeWidth={0.2 + (2 * OW) / r} strokeLinecap="round" />
          <path d="M -0.78 0.22 C -1.1 -1.0 0.9 -1.5 1.0 -0.1" fill="none" stroke={shade(colors.accent, -10)} strokeWidth={0.16} strokeLinecap="round" />
          <circle cx={-0.3} cy={0.3} r={0.36} fill={colors.accent} stroke={ink} strokeWidth={(2 * OW) / r} />
          <circle cx={-0.3} cy={0.3} r={0.2} fill={shade(colors.accent, -24)} />
        </g>
      )}
      {accessories.includes("glasses") && (
        <g>
          {eyes.map((x, i) => (
            <circle key={i} cx={x} cy={-0.0} r={0.2} {...line} />
          ))}
          <path d={`M ${eyes[0] + 0.2} -0.02 Q ${(eyes[0] + eyes[1]) / 2} -0.1 ${eyes[1] - 0.2} -0.02`} {...line} />
          <path d={`M ${eyes[0] - 0.2} -0.02 L -0.72 0.04`} {...line} />
        </g>
      )}
      {accessories.includes("sunglasses") && (
        <g>
          {eyes.map((x, i) => (
            <ellipse key={i} cx={x} cy={0.0} rx={0.22} ry={0.17} fill="#15151c" stroke={ink} strokeWidth={0.04} />
          ))}
          <path d={`M ${eyes[0] + 0.22} -0.04 L ${eyes[1] - 0.22} -0.04 M ${eyes[0] - 0.22} -0.04 L -0.72 0.02`} {...line} />
          <path d={`M ${eyes[1] - 0.12} -0.08 l 0.08 -0.02`} stroke="#ffffff" strokeWidth={0.035} strokeLinecap="round" opacity={0.6} />
        </g>
      )}
    </g>
  );
};

/** The scarf round the neck, in body space: a band at the collar and a tail that swings with the torso. */
export const Scarf = ({ j, colors, ink, flat, swing }: { j: Joints; colors: CharacterColors; ink: string; flat: boolean; swing: number }) => {
  const neck: Pt = { x: j.shoulder.x + (j.head.x - j.shoulder.x) * 0.28, y: j.shoulder.y + (j.head.y - j.shoulder.y) * 0.28 };
  const c = colors.accent;
  const st = { stroke: flat ? "none" : ink, strokeWidth: 2 * OW, strokeLinejoin: "round", paintOrder: "stroke" } as const;
  return (
    <g>
      <path d={`M ${f(neck.x - 0.003)} ${f(neck.y + 0.015)} q ${f(-0.05 - swing * 0.002)} ${f(0.1)} ${f(-0.07 - swing * 0.004)} ${f(0.19)} l 0.05 0.005 q ${f(0.02)} ${f(-0.08)} ${f(0.03)} ${f(-0.17)} Z`} fill={shade(c, -12)} {...st} />
      <ellipse cx={neck.x + 0.005} cy={neck.y} rx={0.055} ry={0.026} transform={`rotate(-14 ${f(neck.x)} ${f(neck.y)})`} fill={c} {...st} />
      {!flat && <path d={`M ${f(neck.x - 0.04)} ${f(neck.y + 0.004)} Q ${f(neck.x)} ${f(neck.y + 0.022)} ${f(neck.x + 0.05)} ${f(neck.y - 0.004)}`} stroke={shade(c, -26)} strokeWidth={0.005} fill="none" />}
    </g>
  );
};

/** A rucksack on the back, behind the torso, with a strap over the shoulder. */
export const BackpackBack = ({ j, colors, ink, flat }: { j: Joints; colors: CharacterColors; ink: string; flat: boolean }) => {
  const c = colors.accent;
  const st = { stroke: flat ? "none" : ink, strokeWidth: 2 * OW, strokeLinejoin: "round", paintOrder: "stroke" } as const;
  const cx = j.shoulder.x + (j.hip.x - j.shoulder.x) * 0.4 - 0.072;
  const cy = j.shoulder.y + (j.hip.y - j.shoulder.y) * 0.4;
  const ang = (Math.atan2(j.hip.x - j.shoulder.x, j.hip.y - j.shoulder.y) * -180) / Math.PI;
  return (
    <g transform={`rotate(${f(ang)} ${f(cx)} ${f(cy)})`}>
      <rect x={cx - 0.05} y={cy - 0.1} width={0.1} height={0.18} rx={0.035} fill={c} {...st} />
      {!flat && <rect x={cx - 0.05} y={cy + 0.02} width={0.1} height={0.06} rx={0.02} fill={shade(c, -16)} />}
    </g>
  );
};

/** The strap over the front of the torso, drawn with the rest of the outfit. */
export const BackpackStrap = ({ j, colors }: { j: Joints; colors: CharacterColors }) => (
  <path d={`M ${f(j.shoulder.x - 0.012)} ${f(j.shoulder.y + 0.005)} L ${f(j.hip.x + 0.03)} ${f(j.hip.y - 0.1)}`} stroke={shade(colors.accent, -18)} strokeWidth={0.014} strokeLinecap="round" fill="none" />
);

type DetailProps = { outfit: Outfit; j: Joints; colors: CharacterColors; ink: string; flat: boolean; /** The torso outline, so details never poke out past it. */ torso: string; id: string };

/** What sets the newer outfits apart, drawn over the plain torso: lapels and a tie, a zip and collar, a bib and straps. */
export const OutfitDetail = ({ outfit, j, colors, ink, flat, torso, id }: DetailProps) => {
  if (flat || (outfit !== "jacket" && outfit !== "suit" && outfit !== "overalls" && outfit !== "robe")) return null;
  const s = j.shoulder;
  const L = Math.hypot(j.hip.x - s.x, j.hip.y - s.y) || 1;
  const a = { x: (j.hip.x - s.x) / L, y: (j.hip.y - s.y) / L };
  const n = { x: a.y, y: -a.x }; // the front of the torso
  const at = (u: number, v: number) => `${f(s.x + a.x * u * L + n.x * v)} ${f(s.y + a.y * u * L + n.y * v)}`;
  const top = colors.top;
  const dark = shade(top, -22);
  const detail = (() => {
  switch (outfit) {
    case "jacket":
      return (
        <g fill="none" stroke={dark} strokeWidth={0.007} strokeLinecap="round" strokeLinejoin="round">
          <path d={`M ${at(0.0, 0.03)} L ${at(0.12, 0.062)} L ${at(0.06, 0.07)}`} fill={shade(top, -10)} />
          <path d={`M ${at(0.1, 0.05)} L ${at(1.0, 0.07)}`} />
          <path d={`M ${at(0.72, 0.01)} h 0.0 L ${at(0.74, 0.07)}`} />
        </g>
      );
    case "robe":
      return (
        <g strokeLinecap="round" strokeLinejoin="round">
          {/* The open neckline, the front edge of the cloth, and a sash knotted at the waist with its ends hanging. */}
          <path d={`M ${at(0.0, 0.03)} L ${at(0.14, 0.012)} L ${at(0.03, -0.03)}`} fill={shade(top, -26)} stroke={dark} strokeWidth={0.005} />
          <path d={`M ${at(0.12, 0.062)} L ${at(1.0, 0.07)}`} fill="none" stroke={dark} strokeWidth={0.006} />
          <path d={`M ${at(0.58, -0.1)} L ${at(0.58, 0.1)} L ${at(0.7, 0.1)} L ${at(0.7, -0.1)} Z`} fill={colors.accent} stroke={shade(colors.accent, -30)} strokeWidth={0.005} />
          <path d={`M ${at(0.66, 0.07)} q 0.012 0.05 0.004 0.12 l 0.026 0 q -0.004 -0.07 -0.006 -0.13 Z`} fill={shade(colors.accent, -14)} stroke={shade(colors.accent, -34)} strokeWidth={0.004} />
        </g>
      );
    case "suit":
      return (
        <g strokeLinecap="round" strokeLinejoin="round">
          <path d={`M ${at(0.03, 0.06)} L ${at(0.44, 0.075)} L ${at(0.03, -0.01)} Z`} fill="#f4f1ea" stroke={dark} strokeWidth={0.005} />
          <path d={`M ${at(0.03, 0.06)} L ${at(0.7, 0.085)}`} fill="none" stroke={dark} strokeWidth={0.008} />
          <path d={`M ${at(0.08, 0.02)} L ${at(0.14, 0.04)} L ${at(0.4, 0.05)} L ${at(0.3, 0.03)} Z`} fill={colors.accent} stroke={shade(colors.accent, -24)} strokeWidth={0.004} />
        </g>
      );
    case "overalls":
      return (
        <g>
          <path d={`M ${at(0.22, -0.1)} L ${at(0.22, 0.1)} L ${at(0.85, 0.1)} L ${at(0.85, -0.1)} Z`} fill={colors.bottom} stroke={ink} strokeWidth={0.0065} strokeLinejoin="round" />
          <path d={`M ${at(0.22, 0.04)} L ${at(0.0, 0.03)} M ${at(0.22, -0.03)} L ${at(0.0, -0.02)}`} stroke={colors.bottom} strokeWidth={0.016} strokeLinecap="round" fill="none" />
          <rect x={s.x + a.x * 0.45 * L + n.x * 0.01 - 0.018} y={s.y + a.y * 0.45 * L + n.y * 0.01 - 0.012} width={0.036} height={0.026} rx={0.004} fill="none" stroke={shade(colors.bottom, -24)} strokeWidth={0.005} />
          <circle cx={s.x + a.x * 0.22 * L + n.x * 0.05} cy={s.y + a.y * 0.22 * L + n.y * 0.05} r={0.006} fill={shade(colors.bottom, 30)} />
        </g>
      );
  }
  })();
  return (
    <g>
      <defs>
        <clipPath id={id}>
          <path d={torso} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>{detail}</g>
    </g>
  );
};
