/**
 * A saved drawing outside the app: renderers that read no stylesheet and drop
 * an important declaration, as Skia does in the document view, still draw it
 * as the window showed it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { standalone } from "./standaloneSvg.js";

afterEach(() => document.body.replaceChildren());

function drawnInWindow(markup: string): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.append(host);
  return host.querySelector("svg")!;
}

function saved(drawing: SVGSVGElement): Document {
  return new DOMParser().parseFromString(standalone(drawing), "image/svg+xml");
}

describe("a drawing saved as a file", () => {
  it("writes what was painted as attributes too, for a renderer that ignores important styles", () => {
    const file = saved(
      drawnInWindow(
        [
          '<svg viewBox="0 0 100 40" style="fill: rgb(0, 0, 0)">',
          '<polyline points="0,0 50,20" style="fill: none; stroke: rgb(240, 107, 82); stroke-width: 2.5px"></polyline>',
          '<text x="4" y="30" style="fill: rgb(155, 157, 162); font: 600 12px Arial, sans-serif">Gas boiler</text>',
          "</svg>",
        ].join(""),
      ),
    );
    const line = file.querySelector("polyline")!;
    const label = file.querySelector("text")!;

    // Unfilled, however the browser spells it.
    expect(line.getAttribute("fill")).toBe(
      (line as unknown as SVGElement).style.getPropertyValue("fill"),
    );
    expect(line.getAttribute("stroke")).toBe("rgb(240, 107, 82)");
    expect(line.getAttribute("stroke-width")).toBe("2.5px");
    expect(label.getAttribute("fill")).toBe("rgb(155, 157, 162)");
    expect(label.getAttribute("font-size")).toBe("12px");
    expect(label.getAttribute("font-weight")).toBe("600");
    expect(label.getAttribute("font-family")).toBe("Arial, sans-serif");
  });

  it("keeps an attribute the drawing set itself", () => {
    const file = saved(
      drawnInWindow(
        '<svg viewBox="0 0 10 10"><line x1="0" x2="10" y1="5" y2="5" stroke-dasharray="8 5" style="stroke: rgb(1, 2, 3); stroke-dasharray: 8px, 5px"></line></svg>',
      ),
    );

    expect(file.querySelector("line")!.getAttribute("stroke-dasharray")).toBe(
      "8 5",
    );
  });
});
