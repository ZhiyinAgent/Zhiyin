// @vitest-environment node
/**
 * A diagram drawn twice is the same size twice, measured on the drawing module
 * alone.
 *
 * Two things that could change a diagram's size between drawings are checked
 * here: drawings started together racing each other through Mermaid's single
 * configuration, and the width of the page they are measured against. Twelve
 * runs that each draw every source at once must agree, and so must five page
 * widths from 1100 down to 520.
 *
 * This page carries none of the application's stylesheets, so a person's motion
 * preference must change nothing here. The application's own animations can
 * change the label measurements Mermaid takes; the drawing module holds them
 * still while Mermaid measures, and the component lab checks the result with
 * the application's styles present.
 *
 * The production module is bundled and driven here rather than restated, so what
 * is measured is the drawing the app does, configuration included.
 */

import { fileURLToPath, URL } from "node:url";
import type { BrowserContext, Page, Request } from "playwright-core";
import {
  playwrightBrowserLauncher,
  type BrowserTarget,
} from "@zhiyin/interactive-browser";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveBundle, type ServedBundle } from "./served-bundle.js";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();

/** The component lab's own diagram sources. */
const sources = [
  "flowchart LR\n  Draft --> Review\n  Review -->|approved| Publish\n  Review -->|changes| Draft",
  [
    "flowchart TB",
    "  classDef pale fill:#f7f5ef,stroke:#b9b2a0,color:#101312",
    "  classDef deep fill:#1d2b45,stroke:#3f5f8f,color:#f4f2ea",
    "  Collect[Collect responses]:::pale --> Clean[Clean and label]:::deep",
    "  Clean --> Review[Review with the team]:::pale",
    "  Review --> Publish[Publish the summary]:::deep",
  ].join("\n"),
  "flowchart LR\n  A[Request] --> B{Allowed?}\n  B -->|yes| C[Run]\n  B -->|no| D[Ask]",
  "sequenceDiagram\n  participant P as Person\n  participant Z as Zhiyin\n  P->>Z: Ask\n  Z-->>P: Answer",
];

const runs = 12;

/**
 * Bundles the production drawing module for the browser and serves it beside a
 * page that calls it. Nothing about the configuration is restated here; a change
 * to how the app initialises Mermaid changes what this measures.
 */
function harness(): Promise<ServedBundle> {
  const page = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Diagram fit</title></head>
  <body>
    <div id="stage"></div>
    <script type="module">
      import { renderMermaid } from "./mermaidRuntime.js";
      window.drawAll = async (sources) => {
        const drawn = await Promise.all(
          sources.map((source, index) => renderMermaid("fit-" + index, source)),
        );
        const stage = document.getElementById("stage");
        return drawn.map((svg) => {
          stage.innerHTML = svg;
          const element = stage.querySelector("svg");
          const box = element.getBoundingClientRect();
          return {
            viewBox: element.getAttribute("viewBox"),
            ratio: Math.round((box.width / box.height) * 1000) / 1000,
          };
        });
      };
      window.drawFramed = async (sources) => {
        const drawn = await Promise.all(
          sources.map((source, index) => renderMermaid("frame-" + index, source)),
        );
        const stage = document.getElementById("stage");
        return drawn.map((svg) => {
          stage.innerHTML = svg;
          const element = stage.querySelector("svg");
          const [x, y, width, height] = element
            .getAttribute("viewBox")
            .split(/\\s+/)
            .map(Number);
          const content = element.getBBox();
          return (
            content.x >= x - 0.5 &&
            content.y >= y - 0.5 &&
            content.x + content.width <= x + width + 0.5 &&
            content.y + content.height <= y + height + 0.5
          );
        });
      };
      window.drawAtWidth = async (sources, width) => {
        document.body.style.width = width + "px";
        // Forces the layout the drawing is about to be measured inside.
        void document.body.getBoundingClientRect().width;
        const drawn = await Promise.all(
          sources.map((source, index) => renderMermaid("w-" + index, source)),
        );
        const stage = document.getElementById("stage");
        return drawn.map((svg) => {
          stage.innerHTML = svg;
          return stage.querySelector("svg").getAttribute("viewBox");
        });
      };
      window.ready = true;
</script>
  </body>
</html>`;

  return serveBundle({
    entry: fileURLToPath(
      new URL("../src/renderer/ui/views/mermaidRuntime.ts", import.meta.url),
    ),
    fileName: "mermaidRuntime.js",
    page: () => page,
  });
}

/**
 * Opens the harness and waits until it can draw.
 *
 * The page's module script holds back DOMContentLoaded until the drawing module
 * has loaded and run, so the launcher's navigation is the wait for that module.
 * It gets the minute this file allows for the module, rather than Playwright's
 * thirty-second default ending it first. When it runs out, the error names the
 * requests still unanswered, so a stall says where it was.
 */
async function openHarness(
  target: BrowserTarget,
  page: Page,
  url: string,
  ready: string,
): Promise<void> {
  const unanswered = new Set<string>();
  const asked = (request: Request) => unanswered.add(request.url());
  const answered = (request: Request) => unanswered.delete(request.url());
  page.on("request", asked);
  page.on("requestfinished", answered);
  page.on("requestfailed", answered);
  page.setDefaultNavigationTimeout(60_000);
  try {
    await target.goto(url);
    await page.waitForFunction((name) => name in window, ready, {
      timeout: 60_000,
    });
  } catch (error) {
    throw new Error(
      `The harness was not ready to draw. Still unanswered: ${[...unanswered].join(", ") || "nothing"}.`,
      { cause: error },
    );
  } finally {
    page.off("request", asked);
    page.off("requestfinished", answered);
    page.off("requestfailed", answered);
  }
}

describe.runIf(availability.available)("diagram fitting", () => {
  let served: ServedBundle;

  beforeAll(async () => {
    served = await harness();
  }, 180_000);

  afterAll(async () => {
    await served?.close();
  });

  it("draws the same diagrams at the same size every time, drawing them together", async () => {
    const target = await launcher.launch({ width: 1100, height: 750 });
    try {
      const open = (target.automation() as BrowserContext).pages()[0];
      if (!open) throw new Error("No browser page");
      await openHarness(target, open, served.url, "drawAll");

      const captures: unknown[] = [];
      for (let run = 0; run < runs; run += 1) {
        captures.push(
          await served.asking(() =>
            open.evaluate(
              (values) =>
                (
                  window as unknown as {
                    drawAll: (v: string[]) => Promise<unknown>;
                  }
                ).drawAll(values),
              [...sources],
            ),
          ),
        );
      }

      const disagreed = captures.filter(
        (capture) => JSON.stringify(capture) !== JSON.stringify(captures[0]),
      );
      expect({
        runs: captures.length,
        disagreed: disagreed.length,
        first: captures[0],
        firstDisagreement: disagreed[0],
      }).toEqual({
        runs,
        disagreed: 0,
        first: captures[0],
        firstDisagreement: undefined,
      });
    } finally {
      await target.close();
    }
  }, 240_000);

  /**
   * The picture frames the whole drawing.
   *
   * Mermaid sizes its picture from the drawing's bounds at the moment it
   * finishes. Anything that leaves a shape in transit at that moment - a
   * transition, however short - gets the bounds of where it started, and the
   * picture crops what ends up outside them, such as the last node of a
   * flowchart and the label under it.
   */
  it("frames every part of each drawing inside its picture", async () => {
    const target = await launcher.launch({ width: 1100, height: 750 });
    try {
      const open = (target.automation() as BrowserContext).pages()[0];
      if (!open) throw new Error("No browser page");
      await openHarness(target, open, served.url, "drawFramed");

      const framed = await served.asking(() =>
        open.evaluate(
          (values) =>
            (
              window as unknown as {
                drawFramed: (v: string[]) => Promise<boolean[]>;
              }
            ).drawFramed(values),
          [...sources],
        ),
      );

      expect(framed).toEqual(sources.map(() => true));
    } finally {
      await target.close();
    }
  }, 240_000);

  /**
   * The same question the lab asks, with none of the application present.
   *
   * Mermaid never reads the reduced-motion media query, so reducing motion must
   * not change the drawing itself - the `viewBox`, not only the box it is
   * painted into. This page carries no stylesheet of the application's, only the
   * bundled drawing module, so a disagreement here puts the cause below the
   * application and an agreement puts it in the application's own CSS.
   */
  it("draws the same diagrams whether or not motion is reduced, with no application styles present", async () => {
    const target = await launcher.launch({ width: 1100, height: 750 });
    try {
      const open = (target.automation() as BrowserContext).pages()[0];
      if (!open) throw new Error("No browser page");

      const capture = async (motion: "no-preference" | "reduce") => {
        await open.emulateMedia({ reducedMotion: motion });
        await openHarness(target, open, served.url, "drawAll");
        return served.asking(() =>
          open.evaluate(
            (values) =>
              (
                window as unknown as {
                  drawAll: (v: string[]) => Promise<unknown>;
                }
              ).drawAll(values),
            [...sources],
          ),
        );
      };

      const ordinary = await capture("no-preference");
      const reduced = await capture("reduce");

      expect({
        settingsAgree: JSON.stringify(ordinary) === JSON.stringify(reduced),
        ordinary,
        reduced,
      }).toMatchObject({ settingsAgree: true });
    } finally {
      await target.close();
    }
  }, 240_000);

  /**
   * The size a drawing comes out at is the drawing's business, not the window's.
   *
   * Mermaid measures its labels inside an element it attaches to the document,
   * so whatever width that element is given is the width its text is laid out
   * against. A lab page whose later sections are still arriving - or one that
   * grows a scrollbar partway through - is not the same width from one moment to
   * the next, so the same drawing must come out the same shape at any of those
   * widths.
   */
  it("draws a diagram to the same shape whatever width the page happens to be", async () => {
    const target = await launcher.launch({ width: 1100, height: 750 });
    try {
      const open = (target.automation() as BrowserContext).pages()[0];
      if (!open) throw new Error("No browser page");
      await openHarness(target, open, served.url, "drawAtWidth");

      const widths = [1100, 1085, 900, 700, 520];
      const byWidth: Record<number, unknown> = {};
      for (const width of widths) {
        byWidth[width] = await served.asking(() =>
          open.evaluate(
            ([values, at]) =>
              (
                window as unknown as {
                  drawAtWidth: (v: string[], w: number) => Promise<unknown>;
                }
              ).drawAtWidth(values as string[], at as number),
            [[...sources], width] as [string[], number],
          ),
        );
      }

      const first = JSON.stringify(byWidth[widths[0]!]);
      const differing = widths.filter(
        (width) => JSON.stringify(byWidth[width]) !== first,
      );
      expect({ differing, drawings: byWidth[widths[0]!] }).toEqual({
        differing: [],
        drawings: byWidth[widths[0]!],
      });
    } finally {
      await target.close();
    }
  }, 240_000);
});
