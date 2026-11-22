import { easeOutBack } from "../easing";
import { SYMBOL_S, type SymbolName } from "./cues";

type Props = {
  name: SymbolName;
  /** Seconds since it appeared. */
  age: number;
  /** Where it sits, in pixels, and how big it is (its width). */
  x: number;
  y: number;
  size: number;
  ink: string;
  t: number;
};

const POP_S = 0.35;
const FADE_S = 0.6;

/** A small picture that pops in beside the lead, floats up a little and fades: a heart for love, a door for leaving. */
export const SymbolArt = ({ name, age, x, y, size, ink, t }: Props) => {
  const pop = easeOutBack(age / POP_S);
  const fade = Math.min(1, (SYMBOL_S - age) / FADE_S);
  if (pop <= 0 || fade <= 0) return null;
  const s = size * pop;
  const float = -size * 0.28 * (age / SYMBOL_S);
  const turn = 6 * Math.sin(age * 2.4);
  const stroke = { stroke: ink, strokeWidth: 0.05, strokeLinejoin: "round", strokeLinecap: "round", paintOrder: "stroke" } as const;
  return (
    <g transform={`translate(${x.toFixed(2)} ${(y + float).toFixed(2)}) rotate(${turn.toFixed(2)}) scale(${s.toFixed(3)})`} opacity={fade}>
      {art(name, age, t, stroke)}
    </g>
  );
};

type Stroke = { readonly stroke: string; readonly strokeWidth: number; readonly strokeLinejoin: "round"; readonly strokeLinecap: "round"; readonly paintOrder: "stroke" };

/** Each drawing fits a box about one unit wide, centred on the origin. */
function art(name: SymbolName, age: number, t: number, st: Stroke) {
  switch (name) {
    case "heart":
      return <path d="M 0 0.42 C -0.62 -0.02 -0.5 -0.5 -0.2 -0.5 C -0.07 -0.5 0 -0.4 0 -0.3 C 0 -0.4 0.07 -0.5 0.2 -0.5 C 0.5 -0.5 0.62 -0.02 0 0.42 Z" fill="#e0556a" {...st} />;
    case "star": {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 ? 0.2 : 0.5;
        const a = (Math.PI * i) / 5 - Math.PI / 2;
        return `${(r * Math.cos(a)).toFixed(3)},${(r * Math.sin(a)).toFixed(3)}`;
      }).join(" ");
      return <polygon points={pts} fill="#f6c945" {...st} />;
    }
    case "rose":
      return (
        <g>
          <path d="M 0 -0.05 Q 0.05 0.25 -0.02 0.5" fill="none" stroke="#3f7a3f" strokeWidth={0.07} strokeLinecap="round" />
          <path d="M 0.02 0.3 q 0.22 -0.12 0.26 -0.3 q -0.2 0 -0.26 0.3 Z" fill="#4f9a4f" {...st} />
          <circle cx={0} cy={-0.22} r={0.27} fill="#c93a52" {...st} />
          <path d="M -0.12 -0.22 a 0.12 0.12 0 0 1 0.24 0 a 0.07 0.07 0 0 1 -0.14 0.02" fill="none" stroke="#7c1d31" strokeWidth={0.04} strokeLinecap="round" />
        </g>
      );
    case "key":
      return (
        <g fill="#e2b13c" {...st}>
          <circle cx={-0.26} cy={0} r={0.18} />
          <circle cx={-0.26} cy={0} r={0.07} fill="none" stroke={st.stroke} strokeWidth={0.04} />
          <rect x={-0.1} y={-0.05} width={0.55} height={0.1} rx={0.03} />
          <rect x={0.28} y={0.03} width={0.07} height={0.16} />
          <rect x={0.4} y={0.03} width={0.07} height={0.12} />
        </g>
      );
    case "door":
      return (
        <g>
          <path d="M -0.26 0.5 V -0.22 Q -0.26 -0.5 0 -0.5 Q 0.26 -0.5 0.26 -0.22 V 0.5 Z" fill="#8a5a36" {...st} />
          <path d="M -0.17 0.44 V -0.2 Q -0.17 -0.4 0 -0.4 Q 0.17 -0.4 0.17 -0.2 V 0.44 Z" fill="#a8744a" />
          <circle cx={0.14} cy={0.1} r={0.035} fill="#f1d27a" />
        </g>
      );
    case "moon":
      return <path d="M 0.05 -0.46 A 0.46 0.46 0 1 0 0.05 0.46 A 0.62 0.62 0 0 1 0.05 -0.46 Z" fill="#f4e7a8" {...st} />;
    case "bird": {
      const flap = Math.sin(t * 9 + age * 3);
      return (
        <g {...st} fill="#4aa3d8">
          <path d={`M -0.3 0.05 Q -0.12 ${(-0.38 - 0.16 * flap).toFixed(3)} 0.04 -0.04 Q 0.2 ${(-0.34 - 0.14 * flap).toFixed(3)} 0.38 0.04 Q 0.2 0.0 0.04 0.1 Q -0.12 0.0 -0.3 0.05 Z`} />
          <circle cx={0.05} cy={0.07} r={0.13} />
          <path d="M 0.17 0.05 l 0.14 0.03 l -0.14 0.04 Z" fill="#f2a33a" />
          <circle cx={0.1} cy={0.04} r={0.025} fill={st.stroke} stroke="none" />
        </g>
      );
    }
    case "clock":
      return (
        <g>
          <circle cx={0} cy={0} r={0.42} fill="#f7f3e8" {...st} />
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1={0.34 * Math.sin((i * Math.PI) / 6)} y1={-0.34 * Math.cos((i * Math.PI) / 6)} x2={0.38 * Math.sin((i * Math.PI) / 6)} y2={-0.38 * Math.cos((i * Math.PI) / 6)} stroke={st.stroke} strokeWidth={0.03} />
          ))}
          <line x1={0} y1={0} x2={0} y2={-0.26} stroke={st.stroke} strokeWidth={0.05} strokeLinecap="round" transform={`rotate(${(age * 120).toFixed(1)})`} />
          <line x1={0} y1={0} x2={0} y2={-0.16} stroke={st.stroke} strokeWidth={0.06} strokeLinecap="round" transform={`rotate(${(age * 10).toFixed(1)})`} />
        </g>
      );
  }
}
