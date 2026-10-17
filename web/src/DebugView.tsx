import { useEffect, useRef } from "react";
import type { AnalysisData } from "../../shared/types";

const W = 1200;
const H = 260;
const LINES = [
  ["rms", "#ffffff"],
  ["low", "#ff5577"],
  ["mid", "#55cc88"],
  ["high", "#55aaff"],
] as const;

export function DebugView({ analysis }: { analysis: AnalysisData }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current!.getContext("2d")!;
    const x = (t: number) => (t / analysis.duration) * W;
    ctx.clearRect(0, 0, W, H);
    analysis.sections.forEach((s, i) => {
      ctx.fillStyle = i % 2 ? "#1d1d2b" : "#262638";
      ctx.fillRect(x(s.start), 0, x(s.end) - x(s.start), H);
      ctx.fillStyle = "#888";
      ctx.fillText(s.label, x(s.start) + 4, 12);
    });
    ctx.strokeStyle = "#ffffff22";
    analysis.beats.forEach((b) => {
      ctx.beginPath();
      ctx.moveTo(x(b), 0);
      ctx.lineTo(x(b), H);
      ctx.stroke();
    });
    ctx.strokeStyle = "#ffcc0088";
    analysis.downbeats.forEach((b) => {
      ctx.beginPath();
      ctx.moveTo(x(b), 0);
      ctx.lineTo(x(b), H);
      ctx.stroke();
    });
    for (const [name, color] of LINES) {
      const s = analysis[name];
      ctx.strokeStyle = color;
      ctx.beginPath();
      s.forEach((v, i) => {
        const px = (i / s.length) * W;
        const py = H - v * (H - 20) - 4;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.stroke();
    }
  }, [analysis]);

  return (
    <div className="panel">
      <p className="mtf-label">
        {analysis.bpm.toFixed(1)} BPM · {analysis.key} · {analysis.duration.toFixed(1)}s · {analysis.beats.length} beats ·{" "}
        {analysis.sections.length} sections
      </p>
      <canvas ref={ref} width={W} height={H} style={{ width: "100%", background: "var(--bg-inset)", borderRadius: 4 }} />
      <small className="hint">white rms · red low · green mid · blue high · faint lines beats · yellow downbeats</small>
    </div>
  );
}
