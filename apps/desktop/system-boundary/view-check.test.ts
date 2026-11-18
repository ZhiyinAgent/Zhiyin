// @vitest-environment node
/**
 * The window's check of a view, in a real browser: what it says was drawn is
 * measured on the drawing laid out in the application's own font, and the
 * picture it hands back is a real PNG of that drawing. The production check is
 * bundled and driven here, not restated.
 */

import { fileURLToPath, URL } from "node:url";
import type { BrowserContext, Page } from "playwright-core";
import { playwrightBrowserLauncher } from "@zhiyin/interactive-browser";
import { openProcessContainer } from "@zhiyin/sandbox";
import type { ViewCheckOutcome, ViewCheckRequest } from "@zhiyin/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveBundle, type ServedBundle } from "./served-bundle.js";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();

/** A PNG's width and height, from its header. */
function pngSize(base64: string): { width: number; height: number } {
  const bytes = Buffer.from(base64, "base64");
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe.runIf(availability.available)("the window's check of a view", () => {
  let served: ServedBundle;

  beforeAll(async () => {
    served = await serveBundle({
      entry: fileURLToPath(new URL("./view-check.entry.ts", import.meta.url)),
      fileName: "view-check.js",
      page: (built) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" /><title>View check</title>
    ${built
      .filter((path) => path.endsWith(".css"))
      .map((path) => `<link rel="stylesheet" href=".${path}" />`)
      .join("\n    ")}
  </head>
  <body>
    <script type="module" src="./view-check.js"></script>
  </body>
</html>`,
    });
  }, 180_000);

  afterAll(async () => {
    await served?.close();
  });

  async function checked(
    requests: readonly ViewCheckRequest[],
  ): Promise<ViewCheckOutcome[]> {
    const target = await launcher.launch({ width: 1100, height: 800 });
    try {
      const page = (target.automation() as BrowserContext).pages()[0] as Page;
      page.setDefaultNavigationTimeout(60_000);
      return await served.asking(async () => {
        await target.goto(served.url);
        await page.waitForFunction(() => "validateView" in window, undefined, {
          timeout: 30_000,
        });
        const outcomes: ViewCheckOutcome[] = [];
        for (const request of requests)
          outcomes.push(
            await page.evaluate(
              (asked) =>
                (
                  window as unknown as {
                    validateView: (
                      request: ViewCheckRequest,
                    ) => Promise<ViewCheckOutcome>;
                  }
                ).validateView(asked),
              request,
            ),
          );
        return outcomes;
      });
    } finally {
      await target.close();
    }
  }

  it("says which bar names it cut short, and returns a picture of the chart at twice its size", async () => {
    const [bars, diagram] = await checked([
      {
        id: "bars",
        kind: "bar-chart",
        source: JSON.stringify({
          kind: "bar-chart",
          title: "Spend",
          categories: [
            {
              label:
                "International Business Machines Corporation research division",
              value: 3,
            },
            { label: "North", value: 2 },
            { label: "South", value: 1 },
            { label: "East", value: 4 },
            { label: "West", value: 5 },
            { label: "Centre", value: 6 },
          ],
        }),
      },
      {
        id: "flow",
        kind: "diagram",
        source: "flowchart LR\n  Draft --> Review\n  Review --> Publish",
      },
    ]);

    if (!bars?.ok || !diagram?.ok) throw new Error("A view was refused.");
    expect(bars.drawn?.facts[0]).toBe("Drawn 720 × 360 px.");
    expect(bars.drawn?.facts[2]).toMatch(
      /^1 of 6 bar names is cut short to fit under their bars: “[^”]+…” for “International Business Machines Corporation research division”\./,
    );
    expect(pngSize(bars.drawn!.picture!.data)).toEqual({
      width: 1440,
      height: 720,
    });
    expect(diagram.drawn?.facts[0]).toBe(
      "Mermaid drew it as a “flowchart-v2” diagram.",
    );
    expect(diagram.drawn?.facts[1]).toMatch(/^Drawn \d+ × \d+ px\.$/);
    expect(diagram.drawn?.picture?.mediaType).toBe("image/png");
    expect(
      Buffer.from(diagram.drawn!.picture!.data, "base64").length,
    ).toBeGreaterThan(2_000);
  });
});
