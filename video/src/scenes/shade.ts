import { hexToHsl, hslToHex } from "../color";

/** A lighter (dl > 0) or darker (dl < 0) version of a colour; darker ones scale, so dark colours stay readable instead of going black. */
export const shade = (hex: string, dl: number) => {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex({ h, s, l: Math.max(0, Math.min(100, dl < 0 ? l * (1 + dl / 70) : l + dl)) });
};
