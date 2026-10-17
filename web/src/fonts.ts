export type FontCategory = "Sans" | "Serif" | "Display" | "Handwriting" | "Mono";
export type FontChoice = { family: string; category: FontCategory };

// A short list of Google Fonts that read well on video. Any other Google Fonts family can still be typed in.
export const FONT_CHOICES: FontChoice[] = [
  { family: "Inter", category: "Sans" },
  { family: "Poppins", category: "Sans" },
  { family: "Montserrat", category: "Sans" },
  { family: "Space Grotesk", category: "Sans" },
  { family: "DM Sans", category: "Sans" },
  { family: "Work Sans", category: "Sans" },
  { family: "Outfit", category: "Sans" },
  { family: "Raleway", category: "Sans" },
  { family: "Rubik", category: "Sans" },
  { family: "Josefin Sans", category: "Sans" },
  { family: "Playfair Display", category: "Serif" },
  { family: "DM Serif Display", category: "Serif" },
  { family: "Cormorant Garamond", category: "Serif" },
  { family: "Lora", category: "Serif" },
  { family: "Merriweather", category: "Serif" },
  { family: "Abril Fatface", category: "Serif" },
  { family: "Bebas Neue", category: "Display" },
  { family: "Anton", category: "Display" },
  { family: "Oswald", category: "Display" },
  { family: "Archivo Black", category: "Display" },
  { family: "Righteous", category: "Display" },
  { family: "Bangers", category: "Display" },
  { family: "Orbitron", category: "Display" },
  { family: "Michroma", category: "Display" },
  { family: "Press Start 2P", category: "Display" },
  { family: "Pacifico", category: "Handwriting" },
  { family: "Caveat", category: "Handwriting" },
  { family: "Dancing Script", category: "Handwriting" },
  { family: "Permanent Marker", category: "Handwriting" },
  { family: "Shadows Into Light", category: "Handwriting" },
  { family: "Amatic SC", category: "Handwriting" },
  { family: "Space Mono", category: "Mono" },
  { family: "JetBrains Mono", category: "Mono" },
  { family: "IBM Plex Mono", category: "Mono" },
];

export const FONT_CATEGORIES: FontCategory[] = ["Sans", "Serif", "Display", "Handwriting", "Mono"];

/** One stylesheet that makes every choice previewable in its own typeface (regular weight). */
export const previewStylesheetUrl = (families: string[]): string =>
  `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`).join("&")}&display=swap`;

/** CSS font-family for showing text in a font, falling back to the UI font while it loads or if the name is wrong. */
export const fontStack = (family: string): string => `"${family.replace(/"/g, "")}", system-ui, sans-serif`;

/** The choices matching a search, grouped in category order, keeping the current font visible even if it isn't on the list. */
export function filterChoices(query: string, current: string): { category: string; fonts: string[] }[] {
  const q = query.trim().toLowerCase();
  const known = new Set(FONT_CHOICES.map((f) => f.family));
  const groups = FONT_CATEGORIES.map((category) => ({
    category: category as string,
    fonts: FONT_CHOICES.filter((f) => f.category === category && f.family.toLowerCase().includes(q)).map((f) => f.family),
  })).filter((g) => g.fonts.length > 0);
  if (current && !known.has(current) && current.toLowerCase().includes(q)) groups.unshift({ category: "Current", fonts: [current] });
  return groups;
}
