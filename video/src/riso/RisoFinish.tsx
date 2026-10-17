import { useMemo, type ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { clamp } from "../timing";
import { dotPitch, PAPER, printScale, registrationOffsets, specks } from "./print";

const GREY_OPAQUE = "0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1";
const CHANNEL = (r: number, g: number, b: number) => `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`;

/** Splits the picture into red, green and blue and prints them a pixel or two apart, so edges pick up coloured fringes. */
export const RisoRegistration = ({ unit, seed, children }: { unit: number; seed: number; children: ReactNode }) => {
  const o = registrationOffsets(unit, seed);
  return (
    <>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id="riso-reg" x="-1%" y="-1%" width="102%" height="102%" colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" type="matrix" values={CHANNEL(1, 0, 0)} result="r" />
            <feColorMatrix in="SourceGraphic" type="matrix" values={CHANNEL(0, 1, 0)} result="g" />
            <feColorMatrix in="SourceGraphic" type="matrix" values={CHANNEL(0, 0, 1)} result="b" />
            <feOffset in="r" dx={o.r.dx} dy={o.r.dy} result="ro" />
            <feOffset in="g" dx={o.g.dx} dy={o.g.dy} result="go" />
            <feOffset in="b" dx={o.b.dx} dy={o.b.dy} result="bo" />
            <feBlend in="ro" in2="go" mode="screen" result="rg" />
            <feBlend in="rg" in2="bo" mode="screen" />
          </filter>
        </defs>
      </svg>
      {/* Scaled up a hair so the shifted channels never expose a coloured seam at the frame edge. */}
      <AbsoluteFill style={{ filter: "url(#riso-reg)", transform: "scale(1.012)" }}>{children}</AbsoluteFill>
    </>
  );
};

/** Paper fibre and mottling, a dot screen and specks, all fixed in place: print texture belongs to the page, so it never flickers. */
export const RisoTexture = ({ width, height, seed, strength }: { width: number; height: number; seed: number; strength: number }) => {
  const unit = Math.min(width, height);
  const pitch = dotPitch(unit);
  const flecks = useMemo(() => specks(seed, width, height), [seed, width, height]);
  const s = clamp(strength);
  const layer = (blend: string, opacity: number, children: ReactNode, key: string) => (
    <AbsoluteFill key={key} style={{ mixBlendMode: blend as "overlay", opacity }}>
      <svg width={width} height={height}>
        {children}
      </svg>
    </AbsoluteFill>
  );
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {layer(
        "overlay",
        0.5 * s,
        <>
          <filter id="riso-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency={0.85 / printScale(unit)} numOctaves={3} seed={seed % 97} stitchTiles="stitch" />
            <feColorMatrix type="matrix" values={GREY_OPAQUE} />
          </filter>
          <rect width={width} height={height} filter="url(#riso-grain)" />
        </>,
        "grain",
      )}
      {layer(
        "overlay",
        0.35 * s,
        <>
          <filter id="riso-mottle" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency={0.011 / printScale(unit)} numOctaves={2} seed={(seed >> 3) % 97} stitchTiles="stitch" />
            <feColorMatrix type="matrix" values={GREY_OPAQUE} />
          </filter>
          <rect width={width} height={height} filter="url(#riso-mottle)" />
        </>,
        "mottle",
      )}
      {layer(
        "multiply",
        0.16 + 0.1 * s,
        <>
          <pattern id="riso-dots" width={pitch} height={pitch} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <circle cx={pitch / 2} cy={pitch / 2} r={pitch * 0.27} fill="#000" />
          </pattern>
          <rect width={width} height={height} fill="url(#riso-dots)" />
        </>,
        "dots",
      )}
      {layer(
        "normal",
        0.55 * s + 0.2,
        flecks.map((f, i) => <circle key={i} cx={f.x} cy={f.y} r={f.r} fill={f.kind === "dark" ? "#14110d" : PAPER} />),
        "specks",
      )}
    </AbsoluteFill>
  );
};
