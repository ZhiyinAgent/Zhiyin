// @vitest-environment node
/**
 * How the document panel fits a page, measured in a real browser: layout is
 * something only a browser does, so the production panel is bundled with the
 * application's stylesheets and measured in one.
 *
 * A PDF page fitted to the panel's width holds still. The panel sizes a page
 * from the width of the space its pages scroll in. A scrollbar that took its
 * room from that width only while it showed could set a page rocking: at the
 * full width the page is a little taller than the panel, so the scrollbar
 * comes and the page shrinks; narrower, it fits, so the scrollbar goes and the
 * page grows again, on every frame. The space is given the size that sets it
 * off: a page whose height at the full width is past the panel's by less than
 * a scrollbar's width takes away. The same page is then shown with the
 * scrollbar's room given back to the page, as it was before the panel kept
 * it, to show that the measurement sees the rocking when it is there.
 *
 * A picture is seen whole: one taller than the panel is drawn to its height,
 * in the middle of the panel's width, with nothing to scroll.
 */

import { fileURLToPath, URL } from "node:url";
import type { BrowserContext, Page } from "playwright-core";
import { playwrightBrowserLauncher } from "@zhiyin/interactive-browser";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentFitPage } from "./document-fit.entry.js";
import { serveBundle, type ServedBundle } from "./served-bundle.js";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();

/** The space around the pages, each side, as the panel keeps it. */
const gutter = 16;
const scrollbar = 12;
const landscape = { width: 1600, height: 1200 };

type Size = { width: number; height: number };

declare const documentFit: DocumentFitPage;

/** Opens a page afresh in a space, as a document is when it is shown. */
const open = (page: Page, space: Size, size: Size, kind: "picture" | "pdf") =>
  page.evaluate(
    ([given, shape, type]) => {
      documentFit.close();
      documentFit.show(given, shape, type);
    },
    [space, size, kind] as const,
  );

/**
 * Opens a PDF page in a space where, at the full width, it is half a
 * scrollbar's worth too tall, and answers every width it takes in a second.
 * The space's size is worked out from a panel opened large first.
 */
async function widthsWhenAlmostFitting(page: Page): Promise<readonly number[]> {
  const wide = { width: 940, height: 2000 };
  await open(page, wide, landscape, "pdf");
  await page.waitForSelector("figure");
  const { across, above } = await page.evaluate(() => documentFit.measured());
  const shape = landscape.height / landscape.width;
  const atFullWidth = (across - 2 * gutter) * shape;
  const space = {
    width: wide.width,
    // The panel's own frame takes a pixel above the pages and one below.
    height: Math.round(
      above + atFullWidth + 2 * gutter - (scrollbar * shape) / 2 + 1,
    ),
  };
  await open(page, space, landscape, "pdf");
  return page.evaluate(() => documentFit.widths(1000));
}

describe.runIf(availability.available)("the document panel's fit", () => {
  let served: ServedBundle;

  beforeAll(async () => {
    served = await serveBundle({
      entry: fileURLToPath(
        new URL("./document-fit.entry.tsx", import.meta.url),
      ),
      fileName: "document-fit.js",
      page: (built) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" /><title>Document fit</title>
    ${built
      .filter((path) => path.endsWith(".css"))
      .map((path) => `<link rel="stylesheet" href=".${path}" />`)
      .join("\n    ")}
  </head>
  <body>
    <div id="stage"></div>
    <script type="module" src="./document-fit.js"></script>
  </body>
</html>`,
    });
  }, 180_000);

  afterAll(async () => {
    await served?.close();
  });

  /** Opens the panel's page in a browser and hands it to `use`. */
  async function inPanel(use: (shown: Page) => Promise<void>) {
    const target = await launcher.launch({ width: 1100, height: 900 });
    try {
      const shown = (target.automation() as BrowserContext).pages()[0];
      if (!shown) throw new Error("No browser page");
      shown.setDefaultNavigationTimeout(60_000);
      // What the page itself threw, so a panel that did not start says why.
      const thrown: string[] = [];
      shown.on("pageerror", (error) => thrown.push(error.message));
      await served.asking(async () => {
        await target.goto(served.url);
        await shown
          .waitForFunction(() => "documentFit" in window, undefined, {
            timeout: 30_000,
          })
          .catch((error: unknown) => {
            throw new Error(
              `The panel's page did not start. It threw: ${thrown.join("; ") || "nothing"}.`,
              { cause: error },
            );
          });
      });
      await use(shown);
    } finally {
      await target.close();
    }
  }

  it("holds a PDF page still that almost fits the panel's height, where giving the scrollbar's room to the page sets it rocking", async () => {
    await inPanel(async (shown) => {
      const kept = await served.asking(() => widthsWhenAlmostFitting(shown));

      // The scrollbar's room handed back to the page, and the margin with it.
      await shown.addStyleTag({
        content:
          '[role="region"] { scrollbar-gutter: auto !important; padding: 16px !important; }',
      });
      const givenBack = await served.asking(() =>
        widthsWhenAlmostFitting(shown),
      );

      expect({
        widthsKept: kept.length,
        rockedWhenGivenBack: givenBack.length > 10,
      }).toEqual({ widthsKept: 1, rockedWhenGivenBack: true });
    });
  }, 240_000);

  it("shows a picture taller than the panel whole: as tall as the panel, in the middle of its width, with nothing to scroll", async () => {
    await inPanel(async (shown) => {
      const placed = await served.asking(async () => {
        await open(
          shown,
          { width: 940, height: 600 },
          { width: 1600, height: 1600 },
          "picture",
        );
        await shown.waitForSelector("figure");
        // Past the panel's settling, so the size it shows is the one it keeps.
        await shown.waitForTimeout(500);
        return shown.evaluate(() => documentFit.placed());
      });
      const near = (value: number, to: number) => Math.abs(value - to) <= 1;

      expect({
        gutterAbove: near(placed.top, gutter),
        gutterBelow: near(placed.bottom, gutter),
        centred: near(placed.left, placed.right),
        scrolls: placed.scrolls,
      }).toEqual({
        gutterAbove: true,
        gutterBelow: true,
        centred: true,
        scrolls: 0,
      });
    });
  }, 240_000);
});
