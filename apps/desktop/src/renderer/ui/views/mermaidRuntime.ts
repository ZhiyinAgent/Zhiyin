import mermaid from "mermaid";
import type { Ink } from "./diagramContrast.js";

/**
 * The ground the drawing itself sits on, and the two letterings available to
 * put on top of it. Named here because the contrast pass and the theme have to
 * agree about them, and a second copy would drift.
 */
export const diagramBackground = "#141817";
export const diagramInk: Ink = { light: "#f4f2ea", dark: "#141817" };

let initialized = false;

function runtime() {
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      // Labels must be SVG text, not HTML in a foreignObject: a foreignObject
      // is stripped on the way out of the renderer and refused on the way into
      // a saved file, so an HTML label is a label nobody ever sees.
      htmlLabels: false,
      theme: "base",
      themeVariables: {
        darkMode: true,
        background: diagramBackground,
        primaryColor: "#202624",
        primaryTextColor: diagramInk.light,
        primaryBorderColor: "#53625d",
        lineColor: "#b5c4be",
        secondaryColor: "#27302d",
        tertiaryColor: "#101312",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      },
      maxTextSize: 50_000,
      maxEdges: 500,
    });
    initialized = true;
  }
  return mermaid;
}

export async function validateMermaid(source: string): Promise<void> {
  await runtime().parse(source);
}

function inertSvg(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || document.querySelector("parsererror"))
    throw new Error("The diagram renderer returned an invalid image.");
  document
    .querySelectorAll("script, foreignObject, iframe, object, embed")
    .forEach((node) => node.remove());
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if (
        (name === "href" || name.endsWith(":href")) &&
        !attribute.value.startsWith("#")
      )
        element.removeAttribute(attribute.name);
    }
  }
  return new XMLSerializer().serializeToString(root);
}

/**
 * The page held still while a diagram is measured.
 *
 * Mermaid sizes a diagram by measuring its labels, and measured 2026-09-14 in a
 * real browser those labels come out about a pixel different while the
 * application's decorative animations are running — same font, same size, a
 * pixel of height. The layout engine turns that pixel into a graph 51px wider
 * with a different origin, so a person's motion preference changed what a
 * diagram was: reducing motion stops the animations, and the drawing changed
 * with them.
 *
 * Six other explanations were measured and ruled out — drawings racing each
 * other, the width of the page, the element Mermaid is given to draw in,
 * queueing the drawings, waiting for fonts, and an animation that forces
 * layout. None of them moved it. Stopping the animations is the only lever that
 * did, so it is applied deliberately and briefly: the same declarations the
 * reduced-motion rule already uses, for the few milliseconds a drawing takes.
 *
 * Counted rather than toggled, because several diagrams are drawn at once and
 * the first to finish must not release the page while the others are measuring.
 */
const stillnessStyleId = "zhiyin-mermaid-stillness";
let drawingsInFlight = 0;

function holdTheFrameStill(): void {
  drawingsInFlight += 1;
  if (document.getElementById(stillnessStyleId)) return;
  const style = document.createElement("style");
  style.id = stillnessStyleId;
  style.textContent =
    "*,*::before,*::after{animation-duration:0.01ms !important;animation-iteration-count:1 !important;transition-duration:0.01ms !important}";
  document.head.appendChild(style);
}

function letTheFrameGo(): void {
  drawingsInFlight = Math.max(0, drawingsInFlight - 1);
  if (drawingsInFlight > 0) return;
  document.getElementById(stillnessStyleId)?.remove();
}

export async function renderMermaid(
  id: string,
  source: string,
): Promise<string> {
  holdTheFrameStill();
  try {
    const result = await runtime().render(
      id.replace(/[^a-zA-Z0-9_-]/g, "-"),
      source,
    );
    return inertSvg(result.svg);
  } finally {
    letTheFrameGo();
  }
}
