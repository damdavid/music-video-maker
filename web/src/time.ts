export const fmtTime = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const fmtRange = (start: number, end: number): string => `${fmtTime(start)}–${fmtTime(end)}`;
