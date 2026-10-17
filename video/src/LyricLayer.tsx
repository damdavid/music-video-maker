import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Line, LyricAnimation, StylePlan } from "../../shared/types";
import { background, brightestAccent, foreground, hexToHsl } from "./color";
import { dissolveStyle, DISSOLVE_S, inkStampOffset, inkStampScale } from "./lyricFx";
import { easeInOutSine } from "./easing";
import { canWrite } from "./strokeFont";
import { StrokeWriting } from "./StrokeWriting";
import { beatPulse, clamp, normalizeWord, wordStates } from "./timing";

type Props = {
  line: Line;
  mode: LyricAnimation;
  plan: StylePlan;
  palette: string[];
  beats: number[];
  fontFamily: string;
  t: number;
  seed: number;
  /** Fade of the whole line (see visibleLines). */
  opacity: number;
  /** 0 while current, rising to 1 as the next line takes over: the line lifts away as it goes. */
  exit: number;
};

// Pen letters have a smaller x-height than the typefaces, so they are set larger to read at the same size.
const HAND_SCALE = 1.4;

const WEIGHT = { bold: 800, elegant: 400, handwritten: 400, mono: 500, condensed: 700 } as const;

/** On a pale background the scrim and shadow must be pale too, or the text sits in a dark smudge. */
const haloOf = (palette: string[]) => (hexToHsl(background(palette)).l > 55 ? "242,237,227" : "0,0,0");

/** Soft scrim so text stays legible over busy visuals; drawn once under every line on screen, so a handover doesn't flicker it. */
export const LyricScrim = ({ palette, opacity }: { palette: string[]; opacity: number }) => (
  <AbsoluteFill style={{ opacity, background: `radial-gradient(ellipse 70% 30% at center, rgba(${haloOf(palette)},0.55), transparent 100%)` }} />
);

export const LyricLayer = ({ line, mode, plan, palette, beats, fontFamily, t, seed, opacity, exit }: Props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const words = wordStates(line, t);
  const emphasis = new Set((plan.emphasis_words ?? []).map(normalizeWord));
  const base = foreground(palette);
  const hi = brightestAccent(palette);
  const portrait = height > width;
  const size = Math.min(width * (portrait ? 0.085 : 0.05), height * 0.09);
  const halo = haloOf(palette);
  const pulse = beatPulse(beats, t);
  // dotDissolve ends the line by breaking the words into dots (visibleLines keeps the text itself from also fading).
  const dissolve = mode === "dotDissolve" ? clamp((t - line.end) / DISSOLVE_S) : 0;
  const lift = easeInOutSine(exit);

  const pop = (w: (typeof words)[number]): React.CSSProperties => {
    const s = spring({ frame: frame - w.start * fps, fps, config: { damping: 11, stiffness: 160 } });
    return { color: base, opacity: Math.min(1, s * 1.5), transform: `scale(${0.6 + 0.4 * s}) translateY(${(1 - s) * 18}px)` };
  };

  const wordStyle = (w: (typeof words)[number], i: number): React.CSSProperties => {
    const sung = w.progress >= 1;
    const active = w.progress > 0 && !sung;
    switch (mode) {
      case "karaoke":
        return { color: sung || active ? hi : base, opacity: sung || active ? 1 : 0.55, transform: active ? "scale(1.08)" : undefined };
      case "pop":
        return pop(w);
      case "handwrite":
        return canWrite(w.text) ? { color: base } : pop(w);
      case "dotDissolve":
        return { ...pop(w), ...dissolveStyle(dissolve, i, seed, size) };
      case "inkStamp": {
        const s = spring({ frame: frame - w.start * fps, fps, config: { damping: 12, stiffness: 190 } });
        const { dx, dy } = inkStampOffset(s, size);
        return {
          color: base,
          opacity: Math.min(1, s * 2),
          transform: `scale(${inkStampScale(s)})`,
          textShadow: `${dx.toFixed(2)}px ${dy.toFixed(2)}px 0 ${hi}, 0 2px 28px rgba(${halo},0.65)`,
        };
      }
      case "typewriter":
        return { color: base };
      case "kinetic": {
        const s = spring({ frame: frame - (w.start - 0.1) * fps, fps, config: { damping: 13 } });
        const hit = emphasis.has(normalizeWord(w.text));
        return {
          color: hit ? hi : base,
          opacity: Math.min(1, s * 1.5),
          transform: `scale(${(0.7 + 0.3 * s) * (hit ? 1.25 + 0.3 * pulse : 1)})`,
          fontWeight: hit ? 800 : undefined,
          // Transforms don't affect layout, so reserve room for the enlarged word.
          margin: hit ? `0 ${size * 0.34}px` : undefined,
        };
      }
    }
  };

  // The pen starts a beat before the word is sung and finishes as it ends, so the word is written by the time it lands.
  const writeProgress = (w: (typeof words)[number]) => easeInOutSine((t - (w.start - 0.12)) / (Math.max(w.end - w.start, 0.35) + 0.12));

  const typed = (w: (typeof words)[number]) => w.text.slice(0, Math.ceil(w.text.length * w.progress));

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: width * 0.08, opacity, transform: lift ? `translateY(${(-lift * size * 0.7).toFixed(2)}px) scale(${(1 - 0.04 * lift).toFixed(4)})` : undefined }}>
      <div
        style={{
          fontFamily,
          fontSize: size,
          fontWeight: WEIGHT[plan.global.typography_style],
          fontStyle: plan.global.typography_style === "elegant" ? "italic" : undefined,
          textTransform: plan.global.typography_style === "condensed" ? "uppercase" : undefined,
          textAlign: "center",
          lineHeight: 1.25,
          textShadow: `0 2px 28px rgba(${halo},0.65)`,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: size * 0.3,
        }}
      >
        {words.map((w, i) => (
          <span key={i} style={{ display: "inline-block", ...wordStyle(w, i) }}>
            {mode === "handwrite" && canWrite(w.text) ? (
              <StrokeWriting text={w.text} progress={writeProgress(w)} size={size * HAND_SCALE} color={base} ink2={{ color: hi, dx: size * 0.04, dy: size * 0.025 }} />
            ) : mode === "typewriter" ? (
              <>
                {typed(w)}
                <span style={{ visibility: "hidden" }}>{w.text.slice(typed(w).length)}</span>
              </>
            ) : (
              w.text
            )}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
