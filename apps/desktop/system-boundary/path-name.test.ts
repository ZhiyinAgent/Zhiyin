// @vitest-environment node
/**
 * A file's name is shown as it is, its spaces included.
 *
 * The name is drawn in two parts, so that a long one can lose its middle and
 * keep its end. A space where the parts meet is one a browser may drop, and
 * whether it does is a matter of layout, which only a browser does, so the
 * production name is bundled with the application's stylesheets and read in
 * one.
 */

import { fileURLToPath, URL } from "node:url";
import type { BrowserContext } from "playwright-core";
import { playwrightBrowserLauncher } from "@zhiyin/interactive-browser";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PathNamePage } from "./path-name.entry.js";
import { serveBundle, type ServedBundle } from "./served-bundle.js";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();

declare const pathName: PathNamePage;

describe.runIf(availability.available)("a file's name", () => {
  let served: ServedBundle;

  beforeAll(async () => {
    served = await serveBundle({
      entry: fileURLToPath(new URL("./path-name.entry.tsx", import.meta.url)),
      fileName: "path-name.js",
      page: (built) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" /><title>Path name</title>
    ${built
      .filter((path) => path.endsWith(".css"))
      .map((path) => `<link rel="stylesheet" href=".${path}" />`)
      .join("\n    ")}
  </head>
  <body>
    <div id="stage"></div>
    <script type="module" src="./path-name.js"></script>
  </body>
</html>`,
    });
  }, 180_000);

  afterAll(async () => {
    await served?.close();
  });

  it("keeps a space where the name's two parts meet, before or after it", async () => {
    const target = await launcher.launch({ width: 900, height: 700 });
    try {
      const shown = (target.automation() as BrowserContext).pages()[0];
      if (!shown) throw new Error("No browser page");
      shown.setDefaultNavigationTimeout(60_000);
      await served.asking(async () => {
        await target.goto(served.url);
        await shown.waitForFunction(() => "pathName" in window, undefined, {
          timeout: 30_000,
        });
      });

      const names = [
        "Hangzhou - Lin 30th.html",
        "Trip notes final 2.html",
        "trips/Hangzhou - Lin 30th.pdf",
      ];
      const widths = await shown.evaluate(
        (paths) => paths.map((path) => pathName.widths(path)),
        names,
      );

      // A space lost would make the name narrower than its text by a space.
      expect(
        Object.fromEntries(
          names.map((name, index) => {
            const { drawn, written } = widths[index]!;
            return [name, Math.abs(drawn - written) < 1];
          }),
        ),
      ).toEqual(Object.fromEntries(names.map((name) => [name, true])));
    } finally {
      await target.close();
    }
  }, 120_000);
});
