// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSafeSvg, parseSafeSvgCached, serializeSafe, walkNodes } from "./safeSvg";

type Fixture = { name: string; svg: string; ok: boolean; mustContain: string[]; mustNotContain: string[] };
const fixtures: Fixture[] = JSON.parse(readFileSync(resolve(process.cwd(), "../shared/svg-fixtures.json"), "utf8"));
const S = 'xmlns="http://www.w3.org/2000/svg"';

describe("parseSafeSvg against the shared malicious-SVG fixtures (same ones the backend sanitizer passes)", () => {
  for (const fx of fixtures) {
    it(fx.name, () => {
      const node = parseSafeSvg(fx.svg);
      if (!fx.ok) {
        expect(node).toBeNull();
        return;
      }
      expect(node).not.toBeNull();
      const out = serializeSafe(node!);
      for (const needle of fx.mustContain) expect(out).toContain(needle);
      for (const needle of fx.mustNotContain) expect(out).not.toContain(needle);
    });
  }
});

describe("parseSafeSvg limits and edge cases", () => {
  it("rejects drawings with too many elements or too much nesting", () => {
    const many = '<rect x="0" y="0" width="1" height="1"/>'.repeat(905);
    expect(parseSafeSvg(`<svg ${S} viewBox="0 0 100 200">${many}</svg>`)).toBeNull();
    expect(parseSafeSvg(`<svg ${S} viewBox="0 0 100 200">${"<g>".repeat(20)}${"</g>".repeat(20)}</svg>`)).toBeNull();
  });

  it("output is stable: sanitizing the serialized result gives the same tree", () => {
    const first = parseSafeSvg(`<svg ${S} viewBox="0 0 100 200"><g id="a" data-pivot="1,2"><rect x="1" y="2" width="3" height="4" fill="#fff"/></g></svg>`)!;
    expect(serializeSafe(parseSafeSvg(serializeSafe(first))!)).toBe(serializeSafe(first));
  });

  it("keeps dashed attribute names exactly as written and drops width/height on the root", () => {
    const node = parseSafeSvg(`<svg ${S} width="999" height="999" viewBox="0 0 100 200"><rect stroke-width="3" x="0" y="0" width="1" height="1"/></svg>`)!;
    expect(node.attrs.width).toBeUndefined();
    expect(node.children[0].attrs["stroke-width"]).toBe("3");
  });

  it("walkNodes visits every element", () => {
    const node = parseSafeSvg(`<svg ${S} viewBox="0 0 100 200"><g><g><rect x="0" y="0" width="1" height="1"/></g></g></svg>`)!;
    expect([...walkNodes(node)].map((n) => n.tag)).toEqual(["svg", "g", "g", "rect"]);
  });

  it("caches by text so a per-frame call doesn't re-parse", () => {
    const text = `<svg ${S} viewBox="0 0 100 200"><rect x="0" y="0" width="1" height="1"/></svg>`;
    expect(parseSafeSvgCached(text)).toBe(parseSafeSvgCached(text));
    expect(parseSafeSvgCached("<html/>")).toBeNull();
  });
});
