export const fmtTime = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** m:ss.cc for places where hundredths matter, such as lyric timing: 65.24 reads 1:05.24. */
export const fmtClock = (seconds: number): string => {
  // Whole hundredths first, so 59.996 carries into the next minute instead of printing 0:59.100.
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 6000)}:${String(Math.floor((cs % 6000) / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

export const fmtRange = (start: number, end: number): string => `${fmtTime(start)}–${fmtTime(end)}`;
