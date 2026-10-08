import mermaid from "mermaid";
import type { Ink } from "./diagramContrast.js";

export type ColourScheme = "light" | "dark";

/**
 * The ground a drawing sits on, the two letterings available to put on top of
 * it, and the colours Mermaid derives the rest from, for each theme. Named here
 * because the contrast pass and the theme have to agree about them, and a
 * second copy would drift. Colours only: nothing here changes a drawing's
 * size, so redrawing it for the other theme keeps its geometry.
 */
const themes: Record<
  ColourScheme,
  {
    readonly background: string;
    readonly ink: Ink;
    readonly variables: Record<string, string | boolean>;
  }
> = {
  dark: {
    background: "#141817",
    ink: { light: "#f4f2ea", dark: "#141817" },
    variables: {
      darkMode: true,
      primaryColor: "#202624",
      primaryBorderColor: "#53625d",
      lineColor: "#b5c4be",
      secondaryColor: "#27302d",
      tertiaryColor: "#101312",
    },
  },
  light: {
    background: "#ffffff",
    ink: { light: "#f4f2ea", dark: "#18191b" },
    variables: {
      darkMode: false,
      primaryColor: "#eef1ef",
      primaryBorderColor: "#8a9893",
      lineColor: "#4f5b57",
      secondaryColor: "#e2e8e5",
      tertiaryColor: "#f7f8f7",
    },
  },
};

export function diagramGround(scheme: ColourScheme): {
  readonly background: string;
  readonly ink: Ink;
} {
  return themes[scheme];
}

let initialized: ColourScheme | undefined;

/** Without a scheme it keeps the one set: checking source needs no colours. */
function runtime(scheme: ColourScheme = initialized ?? "dark") {
  if (initialized !== scheme) {
    const theme = themes[scheme];
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
        ...theme.variables,
        background: theme.background,
        // On the drawing's own ground, so a label still masks the line it
        // sits on without a box of a third colour round it. Left to itself
        // the base theme makes that box near black in the dark theme.
        edgeLabelBackground: theme.background,
        primaryTextColor: scheme === "dark" ? theme.ink.light : theme.ink.dark,
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      },
      maxTextSize: 50_000,
      maxEdges: 500,
    });
    initialized = scheme;
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
 * Mermaid sizes a diagram by measuring its labels, and in a real browser those
 * labels come out about a pixel different while the application's decorative
 * animations are running — same font, same size, a pixel of height. The layout
 * engine turns that pixel into a graph 51px wider with a different origin, so
 * without this a person's motion preference would change what a diagram is.
 * Drawings racing each other, the page's width, the element Mermaid draws in
 * and font loading do not account for it; the animations do. So they are
 * stopped, deliberately and briefly, for the few milliseconds a drawing takes.
 *
 * It switches motion off rather than shortening it, which is what the
 * reduced-motion rule does. A transition duration set on every element turns
 * every property change into a transition, because the property a transition
 * applies to defaults to all of them: a shape Mermaid has just moved into place
 * is still where it started when Mermaid takes the drawing's bounds, and the
 * picture is cut to those. With a short duration, a three-node flowchart's
 * picture can start 63px left of the drawing and lose its last node.
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
    "*,*::before,*::after{animation:none !important;transition:none !important}";
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
  scheme: ColourScheme,
): Promise<string> {
  holdTheFrameStill();
  try {
    const result = await runtime(scheme).render(
      id.replace(/[^a-zA-Z0-9_-]/g, "-"),
      source,
    );
    return inertSvg(result.svg);
  } finally {
    letTheFrameGo();
  }
}
