// @vitest-environment node
/**
 * A diagram drawn twice is the same size twice — the drawing module alone.
 *
 * On 2026-09-11 two captures of identical source disagreed about the size of one
 * diagram and a third agreed with the first. Two explanations were proposed for
 * that and both are ruled out here, by measurement rather than by argument:
 * drawings started together racing each other through Mermaid's single
 * configuration, and the width of the page they are measured against. Twelve
 * concurrent runs agree, and five page widths from 1100 down to 520 agree.
 *
 * The third test helped isolate the cause. This page carries none of the
 * application's stylesheets, and here a person's motion preference changes
 * nothing; the component lab established that ambient application animation
 * changed label measurements. The drawing module now holds those animations
 * still while Mermaid measures, and the lab guards the complete result.
 *
 * The production module is bundled and driven here rather than restated, so what
 * is measured is the drawing the app does, configuration included.
 */

import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import type { BrowserContext } from "playwright-core";
import { build } from "vite";
import { playwrightBrowserLauncher } from "@zhiyin/interactive-browser";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();

/** The lab's own diagram sources, including the one the captures disagreed on. */
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

const contentTypes: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
};

type Harness = {
  readonly url: string;
  close(): Promise<void>;
};

/**
 * Bundles the production drawing module for the browser and serves it beside a
 * page that calls it. Nothing about the configuration is restated here; a change
 * to how the app initialises Mermaid changes what this measures.
 */
async function harness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "zhiyin-diagram-fit-"));
  await build({
    logLevel: "silent",
    build: {
      outDir: directory,
      emptyOutDir: false,
      lib: {
        entry: fileURLToPath(
          new URL(
            "../src/renderer/ui/views/mermaidRuntime.ts",
            import.meta.url,
          ),
        ),
        formats: ["es"],
        fileName: () => "mermaidRuntime.js",
      },
      // Left readable on purpose: when this test fails, the bundle it served is
      // the first thing worth looking at.
      minify: false,
    },
  });

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

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(page);
      return;
    }
    const file = normalize(join(directory, path));
    if (!resolve(file).startsWith(resolve(directory) + sep)) {
      response.writeHead(403).end();
      return;
    }
    // Opened before the headers go out. A browser asks for things nobody served
    // - a favicon, most reliably - and answering those with a 200 and then
    // discovering there is no file leaves nothing valid left to say.
    const stream = createReadStream(file);
    stream.once("error", () => response.writeHead(404).end());
    stream.once("open", () => {
      response.writeHead(200, {
        "Content-Type":
          contentTypes[extname(file)] ?? "application/octet-stream",
      });
      stream.pipe(response);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done, fail) => {
        if (!server.listening) return done();
        server.close((error) => (error ? fail(error) : done()));
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe.runIf(availability.available)("diagram fitting", () => {
  let served: Harness;

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
      await target.goto(served.url);
      await open.waitForFunction(() => "drawAll" in window, undefined, {
        timeout: 60_000,
      });

      const captures: unknown[] = [];
      for (let run = 0; run < runs; run += 1) {
        captures.push(
          await open.evaluate(
            (values) =>
              (
                window as unknown as {
                  drawAll: (v: string[]) => Promise<unknown>;
                }
              ).drawAll(values),
            [...sources],
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
   * The same question the lab asks, with none of the application present.
   *
   * The lab review found that reducing motion changes the drawing itself - the
   * `viewBox`, not just the box it is painted into - which should be impossible,
   * since Mermaid never reads that media query. This page carries no stylesheet
   * of the application's at all, only the bundled drawing module, so a
   * disagreement here puts the cause below the application and an agreement puts
   * it in the application's own CSS.
   */
  it("draws the same diagrams whether or not motion is reduced, with no application styles present", async () => {
    const target = await launcher.launch({ width: 1100, height: 750 });
    try {
      const open = (target.automation() as BrowserContext).pages()[0];
      if (!open) throw new Error("No browser page");

      const capture = async (motion: "no-preference" | "reduce") => {
        await open.emulateMedia({ reducedMotion: motion });
        await target.goto(served.url);
        await open.waitForFunction(() => "drawAll" in window, undefined, {
          timeout: 60_000,
        });
        return open.evaluate(
          (values) =>
            (
              window as unknown as {
                drawAll: (v: string[]) => Promise<unknown>;
              }
            ).drawAll(values),
          [...sources],
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
   * the next, and a drawing measured across that boundary comes out a different
   * shape than the same drawing measured either side of it. That is the only
   * mechanism left that can make one capture disagree with the next, because
   * nothing in the renderer measures a diagram to fit it; the fit is CSS.
   */
  it("draws a diagram to the same shape whatever width the page happens to be", async () => {
    const target = await launcher.launch({ width: 1100, height: 750 });
    try {
      const open = (target.automation() as BrowserContext).pages()[0];
      if (!open) throw new Error("No browser page");
      await target.goto(served.url);
      await open.waitForFunction(() => "drawAtWidth" in window, undefined, {
        timeout: 60_000,
      });

      const widths = [1100, 1085, 900, 700, 520];
      const byWidth: Record<number, unknown> = {};
      for (const width of widths) {
        byWidth[width] = await open.evaluate(
          ([values, at]) =>
            (
              window as unknown as {
                drawAtWidth: (v: string[], w: number) => Promise<unknown>;
              }
            ).drawAtWidth(values as string[], at as number),
          [[...sources], width] as [string[], number],
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
