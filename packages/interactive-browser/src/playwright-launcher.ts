/**
 * The production browser: Edge when it is there, Chrome otherwise, headless
 * and on a profile of its own. Production starts it suspended, assigns its Job
 * Object, then resumes it, so its first instruction cannot create an escapee.
 */

import { accessSync, constants } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Page,
} from "playwright-core";
import { chromium } from "playwright-core";
import type {
  BrowserAvailability,
  BrowserContainment,
  BrowserFrame,
  BrowserLauncher,
  BrowserTarget,
  BrowserViewport,
} from "./index.js";

const channels = ["msedge", "chrome"] as const;
const frameQuality = 55;

function channelName(channel: string): string {
  return channel === "msedge" ? "Microsoft Edge" : "Google Chrome";
}

function browserExecutables(
  environment: NodeJS.ProcessEnv = process.env,
): readonly { path: string; channel: (typeof channels)[number] }[] {
  const roots = [
    environment["ProgramFiles(x86)"],
    environment["ProgramFiles"],
    environment["ProgramW6432"],
    environment["LOCALAPPDATA"],
  ].filter((value): value is string => Boolean(value));
  return channels.flatMap((channel) =>
    roots.map((root) => ({
      channel,
      path: join(
        root,
        channel === "msedge" ? "Microsoft" : "Google",
        channel === "msedge" ? "Edge" : "Chrome",
        "Application",
        channel === "msedge" ? "msedge.exe" : "chrome.exe",
      ),
    })),
  );
}

function installedBrowser(): {
  readonly path: string;
  readonly channel: (typeof channels)[number];
} {
  for (const candidate of browserExecutables()) {
    try {
      accessSync(candidate.path, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(
    "No supported browser is installed. Tried Microsoft Edge and Google Chrome.",
  );
}

async function availablePort(): Promise<number> {
  const server = createServer();
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("No local browser port was available."));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function devtoolsEndpoint(port: number): Promise<string> {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() <= deadline) {
    const ready = await fetch(`${endpoint}/json/version`)
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The browser did not publish its automation endpoint.");
}

function targetFrom(
  browser: Browser,
  context: BrowserContext,
  page: Page,
  cdp: CDPSession,
  channel: string,
  pid: number | undefined,
  viewport: BrowserViewport,
  closeOwner: () => Promise<void>,
): BrowserTarget {
  let closed = false;
  return {
    pid,
    browserName: channelName(channel),
    automation: () => context,
    url: () => page.url(),
    title: () => page.title(),
    goto: async (url) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    back: async () => {
      await page.goBack({ waitUntil: "domcontentloaded" });
    },
    forward: async () => {
      await page.goForward({ waitUntil: "domcontentloaded" });
    },
    reload: async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
    },
    click: async (x, y) => {
      for (const type of ["mousePressed", "mouseReleased"] as const) {
        await cdp.send("Input.dispatchMouseEvent", {
          type,
          x,
          y,
          button: "left",
          clickCount: 1,
        });
      }
    },
    typeText: async (text) => {
      await cdp.send("Input.insertText", { text });
    },
    pressKey: async (key) => {
      await page.keyboard.press(key);
    },
    scroll: async (x, y, deltaY) => {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        deltaX: 0,
        deltaY,
      });
    },
    captureFrame: async () => {
      const shot = await cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: frameQuality,
      });
      return {
        data: shot.data,
        width: viewport.width,
        height: viewport.height,
      };
    },
    startFrames: async (onFrame: (frame: BrowserFrame) => void) => {
      cdp.on("Page.screencastFrame", (frame) => {
        void cdp
          .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
          .catch(() => undefined);
        onFrame({
          data: frame.data,
          width: frame.metadata.deviceWidth ?? 0,
          height: frame.metadata.deviceHeight ?? 0,
        });
      });
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: frameQuality,
        maxWidth: viewport.width,
        maxHeight: viewport.height,
        everyNthFrame: 2,
      });
    },
    onNavigated: (listener) => {
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) listener();
      });
    },
    onLost: (listener) => {
      page.on("close", () => {
        if (!closed) listener();
      });
      browser.on("disconnected", () => {
        if (!closed) listener();
      });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await closeOwner();
    },
  };
}

async function connectedTarget(
  browser: Browser,
  channel: string,
  pid: number | undefined,
  viewport: BrowserViewport,
  closeOwner: () => Promise<void>,
): Promise<BrowserTarget> {
  const context =
    browser.contexts()[0] ?? (await browser.newContext({ viewport }));
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize(viewport);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  return targetFrom(
    browser,
    context,
    page,
    cdp,
    channel,
    pid,
    viewport,
    closeOwner,
  );
}

async function atomicLaunch(
  containment: BrowserContainment,
  viewport: BrowserViewport,
): Promise<BrowserTarget> {
  const container = containment.open();
  const directory = await mkdtemp(
    join(tmpdir(), `zhiyin-browser-${process.pid}-`),
  );
  const profile = join(directory, "profile");
  const stdout = join(directory, "stdout.txt");
  const stderr = join(directory, "stderr.txt");
  const selected = installedBrowser();
  const port = await availablePort();
  let owned: ReturnType<typeof container.launch> | undefined;
  let browser: Browser | undefined;
  try {
    owned = container.launch({
      executable: selected.path,
      arguments: [
        "--headless=new",
        `--remote-debugging-port=${port}`,
        "--remote-debugging-address=127.0.0.1",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        `--window-size=${viewport.width},${viewport.height}`,
        "about:blank",
      ],
      cwd: directory,
      stdout,
      stderr,
    });
    const exited = owned.wait();
    const endpoint = await devtoolsEndpoint(port);
    browser = await chromium.connectOverCDP(endpoint);
    return await connectedTarget(
      browser,
      selected.channel,
      owned.pid,
      viewport,
      async () => {
        container.close();
        await exited.catch(() => undefined);
        await browser?.close().catch(() => undefined);
        await rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 50,
        });
      },
    );
  } catch (error) {
    container.close();
    await owned?.wait().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 50,
    }).catch(() => undefined);
    throw error;
  }
}

export function playwrightBrowserLauncher(
  containment: BrowserContainment,
): BrowserLauncher {
  return {
    async available(): Promise<BrowserAvailability> {
      try {
        const container = containment.open();
        container.close();
        const selected = installedBrowser();
        return {
          available: true,
          browserName: channelName(selected.channel),
        };
      } catch (error) {
        return {
          available: false,
          reason:
            error instanceof Error
              ? error.message
              : "No supported browser could be started.",
        };
      }
    },
    launch: (viewport) => atomicLaunch(containment, viewport),
  };
}
