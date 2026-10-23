import { describe, expect, it } from "vitest";
import { repaintTextForContrast } from "./diagramContrast.js";

const ink = { light: "#f4f2ea", dark: "#141817" };
const background = "#141817";

/** The same two colours as the DOM reports them back after they are set. */
const painted = { light: "rgb(244, 242, 234)", dark: "rgb(20, 24, 23)" };

function drawing(markup: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    "image/svg+xml",
  );
  return parsed.documentElement as unknown as SVGSVGElement;
}

/**
 * Diagrams carry a collapsed rect behind every label — filled, and zero by
 * zero. Sizes are not computed off-screen, so the ones that matter are stated.
 */
function sizeShapes(root: Element) {
  for (const shape of root.querySelectorAll("rect")) {
    const zero = shape.classList.contains("background");
    Object.assign(shape, {
      getBBox: () => ({
        x: 0,
        y: 0,
        width: zero ? 0 : 120,
        height: zero ? 0 : 40,
      }),
    });
  }
}

function inkOf(root: Element, text: string): string {
  const found = [...root.querySelectorAll("text")].find(
    (node) => node.textContent === text,
  );
  return found ? (found as SVGElement).style.getPropertyValue("fill") : "";
}

describe("diagram text contrast", () => {
  it("darkens a label the author put on a pale panel", () => {
    const svg = drawing(`
      <g class="cluster">
        <rect fill="#eaf2ff"></rect>
        <g class="cluster-label"><g>
          <rect class="background" fill="#141817"></rect>
          <text fill="#f4f2ea">1 · Collect &amp; Load</text>
        </g></g>
      </g>`);
    sizeShapes(svg);

    repaintTextForContrast(svg, ink, background);

    expect(inkOf(svg, "1 · Collect & Load")).toBe(painted.dark);
  });

  it("leaves a label that already reads on its own ground alone", () => {
    const svg = drawing(`
      <g class="node">
        <rect fill="#202624"></rect>
        <g class="label"><text fill="#f4f2ea">Raw data source</text></g>
      </g>`);
    sizeShapes(svg);

    repaintTextForContrast(svg, ink, background);

    expect(inkOf(svg, "Raw data source")).toBe("");
  });

  /**
   * The node box is painted over the panel, so it is the ground its own label
   * sits on. Reading the panel instead would darken text on a dark box.
   */
  it("uses the nearest box, not the panel behind it", () => {
    const svg = drawing(`
      <g class="cluster">
        <rect fill="#eaf2ff"></rect>
        <g class="node">
          <rect fill="#202624"></rect>
          <g class="label"><text fill="#f4f2ea">First look</text></g>
        </g>
      </g>`);
    sizeShapes(svg);

    repaintTextForContrast(svg, ink, background);

    expect(inkOf(svg, "First look")).toBe("");
  });

  it("falls back to the diagram's own background when nothing is behind the text", () => {
    const svg = drawing(
      `<g class="edgeLabel"><text fill="#333333">then</text></g>`,
    );
    sizeShapes(svg);

    repaintTextForContrast(svg, ink, background);

    expect(inkOf(svg, "then")).toBe(painted.light);
  });

  /**
   * An author who set a readable colour got it right, and overriding it would
   * be the same presumption in the other direction.
   */
  it("keeps a readable colour the author chose", () => {
    const svg = drawing(`
      <g class="node">
        <rect fill="#eaf2ff"></rect>
        <g class="label"><text fill="#1b2a4a">Deliberate</text></g>
      </g>`);
    sizeShapes(svg);

    repaintTextForContrast(svg, ink, background);

    expect(inkOf(svg, "Deliberate")).toBe("");
  });

  it("repaints the parts of a wrapped label as well as the label", () => {
    const svg = drawing(`
      <g class="node">
        <rect fill="#f6f6f2"></rect>
        <g class="label"><text fill="#f4f2ea"><tspan fill="#f4f2ea">Pale</tspan><tspan>node</tspan></text></g>
      </g>`);
    sizeShapes(svg);

    repaintTextForContrast(svg, ink, background);

    for (const span of svg.querySelectorAll("tspan"))
      expect((span as SVGElement).style.getPropertyValue("fill")).toBe(
        painted.dark,
      );
  });

  it("ignores a zero-sized backdrop that paints nothing", () => {
    const svg = drawing(`
      <g class="cluster">
        <rect fill="#fdf1dc"></rect>
        <g class="cluster-label"><g>
          <rect class="background" fill="#141817"></rect>
          <text fill="#f4f2ea">2 · Assess Quality</text>
        </g></g>
      </g>`);
    sizeShapes(svg);

    repaintTextForContrast(svg, ink, background);

    expect(inkOf(svg, "2 · Assess Quality")).toBe(painted.dark);
  });
});
