import { BOX, layoutStrokes, strokeFractions, strokePath } from "./strokeFont";

type Props = {
  text: string;
  /** 0..1: how much of the text the pen has written. */
  progress: number;
  /** Font size in px; the cap height is about 0.72 of it, like a normal font. */
  size: number;
  color: string;
  /** A second ink printed slightly off register under the first. */
  ink2?: { color: string; dx: number; dy: number };
};

const STROKE_UNITS = 2.1;
// The script letterforms lean past their advance width; this keeps a word clear of the next one.
const TRAIL = 9;

/** Text written stroke by stroke, as inline SVG. Callers must check `canWrite(text)` first. */
export const StrokeWriting = ({ text, progress, size, color, ink2 }: Props) => {
  const laid = layoutStrokes(text);
  const fractions = strokeFractions(laid, progress);
  const scale = (0.72 * size) / BOX.capHeight;
  const pen = (stroke: string, dx: number, dy: number) =>
    laid.strokes.map((s, i) =>
      fractions[i] > 0 ? (
        <path
          key={i}
          d={strokePath(s)}
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - fractions[i]}
          stroke={stroke}
          transform={dx || dy ? `translate(${dx / scale} ${dy / scale})` : undefined}
        />
      ) : null,
    );
  return (
    <svg
      width={(laid.width + TRAIL) * scale}
      height={BOX.height * scale}
      viewBox={`0 ${BOX.top} ${laid.width + TRAIL} ${BOX.height}`}
      fill="none"
      strokeWidth={STROKE_UNITS}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ overflow: "visible", display: "block" }}
    >
      {ink2 && pen(ink2.color, ink2.dx, ink2.dy)}
      {pen(color, 0, 0)}
    </svg>
  );
};
