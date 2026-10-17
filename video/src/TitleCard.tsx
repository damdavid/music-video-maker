import { AbsoluteFill, useVideoConfig } from "remotion";
import type { Meta } from "../../shared/types";
import { background, brightestAccent, foreground, hexToHsl } from "./color";
import { easeInOutSine } from "./easing";
import { canWrite } from "./strokeFont";
import { StrokeWriting } from "./StrokeWriting";
import { clamp, fadeEnvelope } from "./timing";

const CARD_S = 4;

type Props = { meta: Meta; t: number; duration: number; palette: string[]; fontFamily: string; /** Write the title with a pen instead of setting it in type. */ handwritten?: boolean };

export const TitleCard = ({ meta, t, duration, palette, fontFamily, handwritten = false }: Props) => {
  const { width, height } = useVideoConfig();
  const opening = t < CARD_S;
  const closing = t > duration - CARD_S;
  if ((!opening && !closing) || (!meta.title && !meta.artist)) return null;
  const opacity = opening ? fadeEnvelope(t, 0, CARD_S, 0.9) : fadeEnvelope(t, duration - CARD_S, duration, 0.9);
  const unit = Math.min(width, height);
  const halo = hexToHsl(background(palette)).l > 55 ? "242,237,227" : "0,0,0";
  const local = opening ? t : t - (duration - CARD_S);
  const write = (text: string, size: number, from: number, over: number, weight: number) =>
    handwritten && canWrite(text) ? (
      <div style={{ display: "flex", justifyContent: "center", opacity: weight }}>
        <StrokeWriting text={text} progress={easeInOutSine(clamp((local - from) / over))} size={size * 1.4} color={foreground(palette)} ink2={{ color: brightestAccent(palette), dx: size * 0.03, dy: size * 0.02 }} />
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
