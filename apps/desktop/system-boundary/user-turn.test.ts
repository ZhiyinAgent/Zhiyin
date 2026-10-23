// @vitest-environment node
/**
 * A person's message keeps the lines it was written in.
 *
 * Shift+Enter in the composer starts a new line, and the message is sent with
 * it. Whether the bubble shows that line is a matter of layout, which only a
 * browser does, so the production bubble is bundled with the application's
 * stylesheets and measured in one.
 */

import { fileURLToPath, URL } from "node:url";
import type { BrowserContext } from "playwright-core";
import { playwrightBrowserLauncher } from "@zhiyin/interactive-browser";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserTurnPage } from "./user-turn.entry.js";
import { serveBundle, type ServedBundle } from "./served-bundle.js";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();

declare const userTurn: UserTurnPage;

describe.runIf(availability.available)("a person's message", () => {
  let served: ServedBundle;

  beforeAll(async () => {
    served = await serveBundle({
      entry: fileURLToPath(new URL("./user-turn.entry.tsx", import.meta.url)),
      fileName: "user-turn.js",
      page: (built) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" /><title>User turn</title>
    ${built
      .filter((path) => path.endsWith(".css"))
      .map((path) => `<link rel="stylesheet" href=".${path}" />`)
      .join("\n    ")}
  </head>
  <body>
    <div id="stage"></div>
    <script type="module" src="./user-turn.js"></script>
  </body>
</html>`,
    });
  }, 180_000);

  afterAll(async () => {
    await served?.close();
  });

  it("is drawn on the lines it was written on", async () => {
    const target = await launcher.launch({ width: 900, height: 700 });
    try {
      const shown = (target.automation() as BrowserContext).pages()[0];
      if (!shown) throw new Error("No browser page");
      shown.setDefaultNavigationTimeout(60_000);
      await served.asking(async () => {
        await target.goto(served.url);
        await shown.waitForFunction(() => "userTurn" in window, undefined, {
          timeout: 30_000,
        });
      });

      const [oneLine, twoLines, threeLines] = await shown.evaluate(() => [
        userTurn.heightOf("one two"),
        userTurn.heightOf("one\ntwo"),
        userTurn.heightOf("one\n\ntwo"),
      ]);

      // Each line break is one more line, an empty line included.
      expect(twoLines - oneLine).toBeGreaterThan(15);
      expect(threeLines - twoLines).toBeGreaterThan(15);
    } finally {
      await target.close();
    }
  }, 120_000);
});
