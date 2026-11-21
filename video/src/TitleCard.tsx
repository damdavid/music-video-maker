import { AbsoluteFill, useVideoConfig } from "remotion";
import type { Meta } from "../../shared/types";
import { background, brightestAccent, foreground, hexToHsl } from "./color";
import { easeInOutSine } from "./easing";
import { canWrite } from "./strokeFont";
import { StrokeWriting } from "./StrokeWriting";
import { clamp, fadeEnvelope } from "./timing";

const CARD_S = 4;

type Props = {
  meta: Meta;
  t: number;
  duration: number;
  palette: string[];
  fontFamily: string;
  /** Write the title with a pen instead of setting it in type. */
  handwritten?: boolean;
  /** Seconds the opening card holds (default 4); a lyric video holds it through the intro and has no closing card. */
  openFor?: number;
  closing?: boolean;
};

/** The card's fade at time t and how far into its own window it is, or null when it is not showing. */
export function cardPhase(t: number, duration: number, openFor: number, closing: boolean): { opacity: number; local: number; window: number } | null {
  if (t < openFor) return { opacity: fadeEnvelope(t, 0, openFor, Math.min(0.9, openFor / 3)), local: t, window: openFor };
  if (closing && t > duration - CARD_S) return { opacity: fadeEnvelope(t, duration - CARD_S, duration, 0.9), local: t - (duration - CARD_S), window: CARD_S };
  return null;
}

export const TitleCard = ({ meta, t, duration, palette, fontFamily, handwritten = false, openFor = CARD_S, closing = true }: Props) => {
  const { width, height } = useVideoConfig();
  const phase = cardPhase(t, duration, openFor, closing);
  if (!phase || (!meta.title && !meta.artist)) return null;
  const { opacity, window } = phase;
  // The pen is paced for a 4 s card; a shorter one writes faster so it finishes before the fade.
  const pace = Math.min(1, window / CARD_S);
  const unit = Math.min(width, height);
  const halo = hexToHsl(background(palette)).l > 55 ? "242,237,227" : "0,0,0";
  const local = phase.local;
  const write = (text: string, size: number, from: number, over: number, weight: number) =>
    handwritten && canWrite(text) ? (
      <div style={{ display: "flex", justifyContent: "center", opacity: weight }}>
        <StrokeWriting text={text} progress={easeInOutSine(clamp((local - from * pace) / (over * pace)))} size={size * 1.4} color={foreground(palette)} ink2={{ color: brightestAccent(palette), dx: size * 0.03, dy: size * 0.02 }} />
      </div>
    ) : null;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity, fontFamily, color: foreground(palette), textAlign: "center", textShadow: `0 2px 30px rgba(${halo},0.7)` }}>
      {write(meta.title ?? "", unit * 0.085, 0.2, 1.7, 1) ?? <div style={{ fontSize: unit * 0.085, fontWeight: 700 }}>{meta.title}</div>}
      <div style={{ marginTop: unit * 0.02 }}>
        {write(meta.artist ?? "", unit * 0.04, 1.6, 1, 0.85) ?? <div style={{ fontSize: unit * 0.04, opacity: 0.8 }}>{meta.artist}</div>}
      </div>
    </AbsoluteFill>
  );
};
