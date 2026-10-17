import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnalysisData } from "../../../shared/types";
import { GradientFlow } from "./GradientFlow";
import { resolveParams } from "./params";

const analysis = { low: [0.5], high: [0.5] } as unknown as AnalysisData;
const render = (uid: string) =>
  renderToStaticMarkup(
    <GradientFlow uid={uid} frame={0} t={0} width={100} height={100} analysis={analysis} palette={["#000000", "#336699", "#99ccff", "#ffffff"]} intensity={0.5} seed={1} params={resolveParams("gradientFlow", {})} />,
  );
const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

describe("GradientFlow gradient ids", () => {
  it("are unique per layer, so two sections on screen during a transition cannot share a gradient", () => {
    const a = ids(render("p1"));
    const b = ids(render("p2"));
    expect(a.length).toBeGreaterThan(0);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it("are unique within one layer", () => {
    const a = ids(render("p1"));
    expect(new Set(a).size).toBe(a.length);
  });
});
