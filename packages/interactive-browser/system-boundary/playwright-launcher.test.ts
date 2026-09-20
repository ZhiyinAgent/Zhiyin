/**
 * Against a real browser. The session tests prove the state machine; nothing
 * but a browser can prove that a frame is a picture of a page, that a click
 * lands on it, or that there is a process to contain.
 */
import { describe, expect, it } from "vitest";
import type { BrowserContext } from "playwright-core";
import {
  BrowserSession,
  BrowserSessions,
  type BrowserTarget,
} from "../src/index.js";
import { browserAutomation } from "../src/automation-server.js";
import { playwrightBrowserLauncher } from "../src/playwright-launcher.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProcessContainer } from "@zhiyin/process-ownership";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });

// Resolved before the suite is declared, so a machine with no browser skips
// honestly instead of failing, and one with a browser cannot silently skip.
const availability = await launcher.available();

it("checks browser availability without starting an external process", async () => {
  let launches = 0;
  const inspected = playwrightBrowserLauncher({
    open: () => ({
      contain: () => undefined,
      close: () => undefined,
      launch: () => {
        launches += 1;
        throw new Error("Availability must not launch a browser.");
      },
    }),
  });

  await inspected.available();

  expect(launches).toBe(0);
});

const page = `data:text/html,${encodeURIComponent(
  `<title>Takeover</title>
   <style>body{margin:0;font:16px sans-serif}button{width:200px;height:80px}</style>
   <button onclick="document.title='clicked'">Go</button>
   <input id="typed">`,
)}`;

/** Polls a condition rather than sleeping for a guessed duration. */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("the production browser", () => {
  it("names the browser it will use, or says why it has none", () => {
    if (availability.available) {
      expect(availability.browserName).toMatch(/Microsoft Edge|Google Chrome/);
    } else {
      expect(availability.reason).toContain("browser");
    }
  });
});

describe.runIf(availability.available)("a real browser session", () => {
  it("previews a workspace in the watched browser, refreshes after automation, and stops its server", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-browser-preview-"));
    await writeFile(
      join(root, "index.html"),
      "<title>Workspace preview</title><h1>Live preview</h1>",
    );
    const session = new BrowserSession({
      launcher,
      workspaceRoot: () => root,
      viewport: { width: 800, height: 600 },
    });
    const automation = browserAutomation(session);
    try {
      expect((await automation.listTools()).map((tool) => tool.name)).toContain(
        "browser_preview",
      );
      const inspection = await automation.inspect("browser_preview", {
        path: "index.html",
      });
      expect(inspection).toMatchObject({
        ok: true,
        action: "Preview workspace file",
        target: "index.html",
        invocation: { name: "Preview workspace file" },
      });
      const result = await automation.callTool(
        "browser_preview",
        { path: "index.html" },
        undefined,
        inspection.ok ? inspection.identity : undefined,
      );
      expect(result).not.toHaveProperty("isError", true);
      expect(session.state()).toMatchObject({
        status: "open",
        title: "Workspace preview",
      });
      expect(session.lastFrame()?.data.length).toBeGreaterThan(1000);
      const url = session.state().url;
      expect(await (await fetch(url)).text()).toContain("Live preview");
      await automation.callTool("browser_evaluate", {
        function:
          "() => { document.title = 'Updated by automation'; document.body.textContent = 'Updated'; }",
      });
      expect(session.state().title).toBe("Updated by automation");
      expect(
        automation.describeResult(
          "browser_evaluate",
          {},
          { ok: true, value: {} },
        ),
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "facts" })]),
      );
      await automation.callTool("browser_stop_preview", {});
      await expect(fetch(url)).rejects.toThrow();
      await session.close();
      const reopened = await automation.callTool("browser_navigate", {
        url: page,
      });
      expect(reopened).not.toHaveProperty("isError", true);
      expect(session.state().status).toBe("open");
    } finally {
      await automation.close();
      await session.close();
    }
  }, 120_000);
  it("opens a page, shows a picture of it, and takes a click and typing", async () => {
    const session = new BrowserSession({
      launcher,
      viewport: { width: 800, height: 600 },
    });
    const frames: string[] = [];
    session.onFrame((frame) => frames.push(frame.data));
    try {
      await session.open(page);
      expect(session.state()).toMatchObject({
        status: "open",
        title: "Takeover",
        loading: false,
      });
      // The agent gets the very session being watched, not another one.
      expect(session.automation()).toBeDefined();

      // A real JPEG of a real page, not an empty acknowledgement. JPEG's
      // own header, so this cannot pass on a blank or truncated frame.
      await waitFor(() => frames.length > 0);
      const frame = Buffer.from(frames[0] as string, "base64");
      expect(frame.length).toBeGreaterThan(1000);
      expect(frame.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

      await session.click(100, 40);
      await waitFor(() => session.state().title === "clicked");
    } finally {
      await session.close();
    }
    expect(session.state().status).toBe("closed");
    expect(session.automation()).toBeUndefined();
  }, 120_000);

  it("reports a process that can be contained", async () => {
    let target: BrowserTarget | undefined;
    try {
      target = await launcher.launch({ width: 400, height: 300 });
      expect(typeof target.pid).toBe("number");
      expect(target.pid).toBeGreaterThan(0);
    } finally {
      await target?.close();
    }
  }, 120_000);

  /**
   * A second tab is not a second session.
   *
   * The launcher binds one page and watches that one, so anything else the
   * browser opens — a popup, a link that asks for a new tab — must leave the
   * person watching and driving what they were already watching. Opened here
   * through the context rather than by clicking a link, because a headless
   * browser refuses an unprompted `window.open` and the question is what
   * happens once another tab exists, not how it came to.
   */
  it("keeps showing and driving its own page when another tab appears", async () => {
    const session = new BrowserSession({
      launcher,
      viewport: { width: 800, height: 600 },
    });
    try {
      await session.open(page);
      await waitFor(() => session.state().title === "Takeover");

      const context = session.automation() as BrowserContext;
      const before = context.pages().length;
      const second = await context.newPage();
      await second.goto(
        `data:text/html,${encodeURIComponent("<title>Another tab</title>")}`,
      );

      expect(context.pages().length).toBe(before + 1);
      // Still the page the person was watching, not the one that just arrived.
      expect(session.state()).toMatchObject({
        status: "open",
        title: "Takeover",
      });

      // And still the page their input reaches.
      await session.click(100, 40);
      await waitFor(() => session.state().title === "clicked");
    } finally {
      await session.close();
    }
  }, 180_000);

  /**
   * The same question, asked the way it actually happens.
   *
   * The test above opens the tab through the context, which cannot be blocked
   * and cannot be refused. A link asking for a new tab is a person's own click,
   * so the browser allows it — and that is the path a popup really arrives by.
   */
  it("keeps its own page when a click opens a popup", async () => {
    const opener = `data:text/html,${encodeURIComponent(
      `<title>Opener</title>
       <style>body{margin:0}a{display:block;width:200px;height:80px}</style>
       <a target="_blank" href="about:blank">Open</a>`,
    )}`;
    const session = new BrowserSession({
      launcher,
      viewport: { width: 800, height: 600 },
    });
    try {
      await session.open(opener);
      await waitFor(() => session.state().title === "Opener");
      const context = session.automation() as BrowserContext;
      const before = context.pages().length;

      await session.click(100, 40);

      await waitFor(() => context.pages().length > before);
      // The popup exists, and the person is still looking at what they had.
      expect(session.state()).toMatchObject({
        status: "open",
        title: "Opener",
      });
      expect(session.state().url).toContain("Opener");
    } finally {
      await session.close();
    }
  }, 180_000);

  /**
   * Two conversations, two browsers, at the same time.
   *
   * `BrowserSessions` had one test and it used fakes, which can only prove that
   * the map holds two entries. That two real browsers run at once, and that
   * closing one leaves the other running and usable, is the part a fake cannot
   * answer.
   */
  it("runs a browser for each conversation at once, and closing one leaves the other", async () => {
    const sessions = new BrowserSessions(
      () =>
        new BrowserSession({ launcher, viewport: { width: 800, height: 600 } }),
    );
    const other = `data:text/html,${encodeURIComponent("<title>Second</title>")}`;
    try {
      await sessions.browser("first").open(page);
      await sessions.browser("second").open(other);

      expect(sessions.browser("first").state()).toMatchObject({
        status: "open",
        title: "Takeover",
      });
      expect(sessions.browser("second").state()).toMatchObject({
        status: "open",
        title: "Second",
      });
      // Separate browsers, not one shared page answering to two names.
      expect(sessions.browser("first").automation()).not.toBe(
        sessions.browser("second").automation(),
      );

      await sessions.close("first");

      expect(sessions.browser("first").state().status).toBe("closed");
      expect(sessions.browser("second").state().status).toBe("open");
      // The survivor is still live, not merely still recorded as open.
      await sessions.browser("second").navigate(page);
      await waitFor(
        () => sessions.browser("second").state().title === "Takeover",
      );
    } finally {
      await sessions.closeAll();
    }
  }, 180_000);

  /**
   * Closing while a navigation is still in flight.
   *
   * A person who asks for a page and changes their mind leaves a request that
   * will never arrive. Closing has to finish anyway, the session has to end up
   * closed, and the abandoned navigation must settle rather than be left as a
   * rejection nobody is waiting for.
   */
  it("closes while a navigation that will never arrive is still in flight", async () => {
    const server = createServer(() => {
      /* Accepts the request and answers nothing, for as long as it is open. */
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");

    const session = new BrowserSession({
      launcher,
      viewport: { width: 800, height: 600 },
    });
    try {
      await session.open(page);
      await waitFor(() => session.state().title === "Takeover");

      // Caught immediately: whichever way it settles, it must not surface as an
      // unhandled rejection after the test has moved on.
      const settled = session
        .navigate(`http://127.0.0.1:${address.port}/`)
        .then(
          () => "resolved",
          () => "rejected",
        );

      await session.close();

      expect(await settled).toMatch(/resolved|rejected/);
      expect(session.state().status).toBe("closed");
      expect(session.automation()).toBeUndefined();
    } finally {
      await session.close();
      server.closeAllConnections();
      await new Promise<void>((done, fail) => {
        if (!server.listening) return done();
        server.close((error) => (error ? fail(error) : done()));
      });
    }
  }, 180_000);

  it("lets the agent drive the very page the panel is showing", async () => {
    const session = new BrowserSession({
      launcher,
      viewport: { width: 800, height: 600 },
    });
    const automation = browserAutomation(session);
    try {
      // Tools are offered before anything is running.
      const tools = await automation.listTools();
      expect(tools.map((tool) => tool.name)).toContain("browser_navigate");
      expect(session.state().status).toBe("closed");

      // The first call opens the browser, and with it the panel.
      await automation.callTool("browser_navigate", { url: page });

      await waitFor(() => session.state().title === "Takeover");
      expect(session.state().status).toBe("open");

      // The panel is looking at that same page, not a second one: a click
      // through the panel lands on what the agent navigated to.
      await session.click(100, 40);
      await waitFor(() => session.state().title === "clicked");
      expect(session.lastFrame()?.data.length).toBeGreaterThan(0);
    } finally {
      await automation.close();
      await session.close();
    }
  }, 180_000);
});
