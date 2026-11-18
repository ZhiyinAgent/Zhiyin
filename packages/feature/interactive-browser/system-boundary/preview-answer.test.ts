/**
 * What opening the preview says of a page, measured by a real browser: only
 * a browser lays a page out, so only one can say whether it is wider than its
 * viewport, which element makes it so, and which box scrolls sideways.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { openProcessContainer } from "@zhiyin/sandbox";
import { BrowserSession } from "../src/index.js";
import { browserAutomation } from "../src/automation-server.js";
import { playwrightBrowserLauncher } from "../src/playwright-launcher.js";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();
const folders = new TemporaryFolders();

describe.runIf(availability.available)(
  "opening the preview in a real browser",
  () => {
    let root = "";
    let session: BrowserSession;
    let automation: ReturnType<typeof browserAutomation>;
    beforeAll(async () => {
      root = await folders.make("zhiyin-preview-answer-");
      session = new BrowserSession({
        launcher,
        workspaceRoot: () => root,
        viewport: { width: 800, height: 600 },
      });
      automation = browserAutomation(session, { acceptsImages: () => false });
    });
    afterAll(async () => {
      await automation.close();
      await session.close();
      await folders.removeAll();
    });

    /** What previewing a page of this markup says, before its snapshot. */
    async function previewed(name: string, html: string): Promise<string> {
      await writeFile(join(root, name), html);
      const inspection = await automation.inspect("browser_preview", {
        path: name,
      });
      const result = (await automation.callTool(
        "browser_preview",
        { path: name },
        undefined,
        inspection.ok ? inspection.identity : undefined,
      )) as { isError?: boolean; content: { text?: string }[] };
      expect(result.isError).toBeFalsy();
      return result.content.map((part) => part.text ?? "").join("\n");
    }

    const viewport = "Viewport 800 × 600 px.";

    it("says a page fits its width when the viewport cannot scroll sideways, the overflow set on the page's body or on its root", async () => {
      const wide = `<div class="wide" style="width:1400px;height:20px"></div>`;
      const body = await previewed(
        "hidden-body.html",
        `<title>t</title><style>body{margin:0;overflow-x:hidden}</style>${wide}`,
      );
      const clipped = await previewed(
        "clip-body.html",
        `<title>t</title><style>body{margin:0;overflow-x:clip}</style>${wide}`,
      );
      const html = await previewed(
        "hidden-html.html",
        `<title>t</title><style>html{overflow-x:hidden}body{margin:0}</style>${wide}`,
      );
      const menu = await previewed(
        "off-canvas.html",
        `<title>t</title><style>body{margin:0;overflow-x:hidden}nav{position:absolute;top:0;right:-300px;width:300px}</style><p>content</p><nav>menu</nav>`,
      );

      for (const said of [body, clipped, html, menu])
        expect(said).toContain(`${viewport} The page fits its width.`);
    }, 120_000);

    it("names the outermost element that reaches furthest, not its last descendant", async () => {
      const said = await previewed(
        "container.html",
        `<title>t</title><style>body{margin:0}main{width:1400px}</style><main><h1>Title</h1><section><p>Text</p></section></main>`,
      );

      expect(said).toContain(
        `${viewport} The page is 1400 px wide, 600 px wider than the viewport: main reaches 1400 px.`,
      );
    }, 60_000);

    it("names the element itself when only it reaches past the viewport", async () => {
      const said = await previewed(
        "leaf.html",
        `<title>t</title><style>body{margin:0}</style><div class="wrap"><table class="wide" style="width:1400px"><tr><td>row</td></tr></table></div>`,
      );

      expect(said).toContain(
        `${viewport} The page is 1400 px wide, 600 px wider than the viewport: table.wide reaches 1400 px.`,
      );
    }, 60_000);

    it("names a box as large as half the viewport that scrolls sideways, as an app's main area does", async () => {
      const said = await previewed(
        "app.html",
        `<title>t</title><style>body{margin:0;height:100vh;overflow:hidden;display:flex;flex-direction:column}header{height:50px}main{flex:1;overflow:auto}table{width:1400px}</style><header>App</header><main><table><tr><td>wide row</td></tr></table></main>`,
      );

      expect(said).toContain(
        `${viewport} The page fits its width. main scrolls sideways: its content is 1400 px wide in a box 800 px wide.`,
      );
    }, 60_000);

    it("does not name a small box that scrolls sideways, such as a code block", async () => {
      const said = await previewed(
        "code.html",
        `<title>t</title><style>body{margin:0}pre{width:600px;overflow:auto}</style><pre>${"x".repeat(400)}</pre>`,
      );

      expect(said).toContain(`${viewport} The page fits its width.\n`);
    }, 60_000);

    it("gives widths that agree when a vertical scroll bar takes part of the viewport", async () => {
      const said = await previewed(
        "tall.html",
        `<title>t</title><style>body{margin:0}.hero{width:100vw;height:3000px}</style><div class="hero"></div>`,
      );

      const line =
        /Viewport 800 × 600 px, of which the vertical scroll bar takes (\d+) px\. The page is 800 px wide, (\d+) px wider than the (\d+) px left: div\.hero reaches 800 px\./.exec(
          said,
        );
      expect(line).not.toBeNull();
      const [, bar, over, left] = line!.map(Number);
      expect(bar).toBeGreaterThan(0);
      expect(over).toBe(bar);
      expect(left).toBe(800 - bar!);
    }, 60_000);

    it("gives one count of the console's errors", async () => {
      const said = await previewed(
        "console.html",
        `<title>t</title><p>x</p><script>console.warn("a warning"); console.error("an error"); console.assert(false, "assert failed"); throw new Error("thrown");</script>`,
      );

      expect(said).toContain("3 console errors since the page opened:");
      expect(said).not.toContain("- Console:");
    }, 60_000);
  },
);
