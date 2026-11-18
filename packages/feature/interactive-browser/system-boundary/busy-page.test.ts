/**
 * A page whose script never yields, against a real browser. Such a page
 * answers nothing, so every call that waits on it would wait for ever; only a
 * real browser shows that its script can be stopped and the page then answers.
 * The bound is a second here, so each case ends in a few.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { openProcessContainer } from "@zhiyin/sandbox";
import { BrowserSession } from "../src/index.js";
import { browserAutomation } from "../src/automation-server.js";
import { playwrightBrowserLauncher } from "../src/playwright-launcher.js";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();
const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

/** A page on this computer, outside any preview, whose script never yields. */
const site = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(
    "<title>Spinning</title><p>before</p><script>for (;;) {}</script>",
  );
});
await new Promise<void>((done) => site.listen(0, "127.0.0.1", done));
const spinning = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
afterAll(() => {
  site.closeAllConnections();
  site.close();
});

type Answer = { isError?: boolean; content: { text?: string }[] };
const words = (answer: Answer) =>
  answer.content.map((part) => part.text ?? "").join("\n");

/** A browser session on a workspace holding these files, with its automation. */
async function browsing(files: Record<string, string>) {
  const root = await folders.make("zhiyin-busy-page-");
  for (const [name, text] of Object.entries(files))
    await writeFile(join(root, name), text);
  const session = new BrowserSession({
    launcher,
    workspaceRoot: () => root,
    viewport: { width: 800, height: 600 },
    busyPageMs: 1_000,
  });
  const automation = browserAutomation(session, { acceptsImages: () => true });
  const call = async (name: string, args: Record<string, unknown>) => {
    const inspection = await automation.inspect(name, args);
    const started = Date.now();
    const answer = (await automation.callTool(
      name,
      args,
      undefined,
      inspection.ok ? inspection.identity : undefined,
    )) as Answer;
    return {
      answer,
      said: words(answer),
      seconds: (Date.now() - started) / 1000,
    };
  };
  const end = async () => {
    await automation.close();
    await session.close();
  };
  return { session, call, end };
}

const stopped =
  "its script kept the page busy for 1 s without yielding, so Zhiyin stopped it";

describe.runIf(availability.available)(
  "a page whose script never yields",
  () => {
    it("ends the preview within the bound, says the page did not finish loading, and leaves the browser usable", async () => {
      const { session, call, end } = await browsing({
        "index.html": `<title>Busy</title><p>before</p><script>for (;;) {}</script><p>after</p>`,
        "fixed.html": `<title>Fixed</title><p>fixed</p>`,
      });
      try {
        const preview = await call("browser_preview", { path: "index.html" });

        expect(preview.seconds).toBeLessThan(15);
        expect(preview.answer.isError).toBe(true);
        expect(preview.said).toContain(
          `The page did not finish loading: ${stopped}.`,
        );
        expect(session.state().status).toBe("open");
        const fixed = await call("browser_preview", { path: "fixed.html" });
        expect(fixed.answer.isError).toBeFalsy();
        expect(fixed.said).toContain("paragraph");
        expect(fixed.said).toContain("fixed");
        expect(fixed.said).not.toContain(stopped);
      } finally {
        await end();
      }
    }, 60_000);

    it("ends the preview of a page that starts spinning once it has loaded", async () => {
      const { call, end } = await browsing({
        "index.html": `<title>Late</title><p>hi</p><script>setTimeout(() => { for (;;) {} }, 50);</script>`,
      });
      try {
        const preview = await call("browser_preview", { path: "index.html" });

        expect(preview.seconds).toBeLessThan(15);
        expect(preview.answer.isError).toBe(true);
        expect(preview.said).toContain(stopped);
        const snapshot = await call("browser_snapshot", {});
        expect(snapshot.seconds).toBeLessThan(15);
        expect(snapshot.said).toContain("hi");
      } finally {
        await end();
      }
    }, 60_000);

    it("stops code run on the page that never yields, and says so", async () => {
      const { call, end } = await browsing({
        "index.html": `<title>Calm</title><p>calm</p>`,
      });
      try {
        await call("browser_preview", { path: "index.html" });

        const evaluated = await call("browser_evaluate", {
          function: "() => { for (;;) {} }",
        });

        expect(evaluated.seconds).toBeLessThan(15);
        expect(evaluated.said).toContain(stopped);
        const after = await call("browser_evaluate", {
          function: "() => document.title",
        });
        expect(after.said).toContain("Calm");
      } finally {
        await end();
      }
    }, 60_000);

    it("stops a page it was sent to whose script never yields", async () => {
      const { call, end } = await browsing({});
      try {
        const navigated = await call("browser_navigate", { url: spinning });

        expect(navigated.seconds).toBeLessThan(15);
        expect(navigated.said).toContain(stopped);
        const title = await call("browser_evaluate", {
          function: "() => document.title",
        });
        expect(title.said).toContain("Spinning");
      } finally {
        await end();
      }
    }, 60_000);

    it("stops a click whose handler never yields", async () => {
      const { call, end } = await browsing({
        "index.html": `<title>Button</title><button onclick="for (;;) {}">Spin</button>`,
      });
      try {
        await call("browser_preview", { path: "index.html" });
        const snapshot = await call("browser_snapshot", {});
        const ref = /button "Spin" \[ref=(\w+)\]/.exec(snapshot.said)?.[1];

        const clicked = await call("browser_click", {
          element: "Spin button",
          target: ref,
        });

        expect(clicked.seconds).toBeLessThan(15);
        expect(clicked.said).toContain(stopped);
      } finally {
        await end();
      }
    }, 60_000);

    it("leaves a page waiting on its dialog alone, so the script goes on once it is answered", async () => {
      const { session, call, end } = await browsing({
        "index.html": `<title>Ask</title><button onclick="alert('Saved'); document.title = 'Answered'">Save</button>`,
      });
      try {
        await call("browser_preview", { path: "index.html" });
        const snapshot = await call("browser_snapshot", {});
        const ref = /button "Save" \[ref=(\w+)\]/.exec(snapshot.said)?.[1];

        const clicked = await call("browser_click", {
          element: "Save button",
          target: ref,
        });
        const answered = await call("browser_handle_dialog", { accept: true });
        const title = await call("browser_evaluate", {
          function: "() => document.title",
        });

        // The answer is not held while the page waits on its dialog, which
        // answers nothing until it is answered.
        expect(clicked.seconds).toBeLessThan(1);
        expect(clicked.said).toContain('"alert" dialog with message "Saved"');
        expect(session.state().title).toBe("Answered");
        expect(clicked.said + answered.said).not.toContain(stopped);
        expect(title.said).toContain("Answered");
      } finally {
        await end();
      }
    }, 60_000);
  },
);
