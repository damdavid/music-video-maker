import { AbsoluteFill } from "remotion";
import { clamp } from "./timing";

export const Vignette = ({ amount }: { amount: number }) =>
  amount > 0 ? <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,${clamp(amount) * 0.9}) 100%)` }} /> : null;

export const Grain = ({ amount, frame, width, height }: { amount: number; frame: number; width: number; height: number }) =>
  amount > 0 ? (
    <AbsoluteFill style={{ opacity: clamp(amount) * 0.4, mixBlendMode: "overlay", pointerEvents: "none" }}>
      <svg width={width} height={height}>
        <filter id="grain">
          {/* Reseeded every 2 frames so grain flickers like film but stays deterministic. */}
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed={Math.floor(frame / 2) % 16} stitchTiles="stitch" />
        </filter>
        <rect width={width} height={height} filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  ) : null;
