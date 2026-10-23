// @vitest-environment node
/**
 * The message a person is reading stays where it is when the column changes
 * width, in a compacted conversation as in any other.
 *
 * The window keeps the place itself, from the entry at the top of the view;
 * the browser's own scroll anchoring is turned off here so that is what is
 * measured. Layout is a browser's, so the production conversation is bundled
 * with the application's stylesheets and measured in one.
 */

import { fileURLToPath, URL } from "node:url";
import type { BrowserContext } from "playwright-core";
import { playwrightBrowserLauncher } from "@zhiyin/interactive-browser";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReadingPlacePage } from "./reading-place.entry.js";
import { serveBundle, type ServedBundle } from "./served-bundle.js";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();

declare const readingPlace: ReadingPlacePage;

describe.runIf(availability.available)("a person's place", () => {
  let served: ServedBundle;

  beforeAll(async () => {
    served = await serveBundle({
      entry: fileURLToPath(
        new URL("./reading-place.entry.tsx", import.meta.url),
      ),
      fileName: "reading-place.js",
      page: (built) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" /><title>Reading place</title>
    ${built
      .filter((path) => path.endsWith(".css"))
      .map((path) => `<link rel="stylesheet" href=".${path}" />`)
      .join("\n    ")}
  </head>
  <body>
    <div id="stage"></div>
    <script type="module" src="./reading-place.js"></script>
  </body>
</html>`,
    });
  }, 180_000);

  afterAll(async () => {
    await served?.close();
  });

  it.each([
    ["a conversation", false],
    ["a compacted conversation", true],
  ])(
    "stays put in %s when the column narrows",
    async (_, compacted) => {
      const target = await launcher.launch({ width: 1000, height: 800 });
      try {
        const shown = (target.automation() as BrowserContext).pages()[0];
        if (!shown) throw new Error("No browser page");
        shown.setDefaultNavigationTimeout(60_000);
        await served.asking(async () => {
          await target.goto(served.url);
          await shown.waitForFunction(
            () => "readingPlace" in window,
            undefined,
            {
              timeout: 30_000,
            },
          );
        });
        await shown.evaluate(
          (compacted) => readingPlace.show(compacted),
          compacted,
        );

        // The person scrolls down by hand until message 15 is near the top.
        await shown.mouse.move(400, 300);
        for (let turn = 0; turn < 60; turn += 1) {
          const offset = await shown.evaluate(() =>
            readingPlace.offsetOf("Message 15."),
          );
          if (offset < 300) break;
          await shown.mouse.wheel(0, 150);
          await shown.waitForTimeout(50);
        }
        await shown.waitForTimeout(300);
        // The message being read: the one at the top of the view.
        const reading = await shown.evaluate(() => readingPlace.topMessage());
        // Past the compacted first ten.
        expect(reading).toMatch(/^Message 1\d\./);
        const before = await shown.evaluate(
          (reading) => readingPlace.offsetOf(reading),
          reading,
        );

        await shown.evaluate(() => readingPlace.widen(450));
        await shown.waitForTimeout(500);
        const after = await shown.evaluate(
          (reading) => readingPlace.offsetOf(reading),
          reading,
        );

        expect(Math.abs(after - before)).toBeLessThan(4);
      } finally {
        await target.close();
      }
    },
    120_000,
  );
});
