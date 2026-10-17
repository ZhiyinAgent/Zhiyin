/**
 * The production browser: Edge when it is there, Chrome otherwise, headless
 * and on a profile of its own. Production starts it suspended, assigns its Job
 * Object, then resumes it, so its first instruction cannot create an escapee.
 * It is driven over two pipes only Zhiyin holds, never a port: the DevTools
 * protocol has no authentication, so a port would let any program on the
 * machine drive it (ADR 0017).
 */

import { accessSync, constants } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Browser,
  BrowserContext,
  CDPSession,
  ConnectOverCDPTransport,
  Page,
} from "playwright-core";
import type { ProcessPipes } from "@zhiyin/process-ownership";
import { chromium } from "playwright-core";
import { clearAbandonedProfiles } from "./abandoned-profiles.js";
import { drawnAtScale } from "./frame-scale.js";
import type {
  BrowserAvailability,
  BrowserContainment,
  BrowserFrame,
  BrowserLauncher,
  BrowserTarget,
  BrowserViewport,
  StoppedDownload,
} from "./interactive-browser.js";

const channels = ["msedge", "chrome"] as const;
const frameQuality = 80;

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

/**
 * The DevTools protocol over the browser's pipes: one JSON message per
 * NUL-terminated chunk, Chromium's default framing for them.
 */
function pipeTransport(pipes: ProcessPipes): ConnectOverCDPTransport {
  let pending: Buffer[] = [];
  let closed = false;
  const transport: ConnectOverCDPTransport = {
    send(message) {
      if (!closed) pipes.toProcess.write(`${JSON.stringify(message)}\0`);
    },
    close: () => releasePipes(pipes),
  };
  const lost = () => {
    if (closed) return;
    closed = true;
    transport.onclose?.();
  };
  pipes.fromProcess.on("data", (chunk: Buffer) => {
    let start = 0;
    for (
      let end = chunk.indexOf(0);
      end !== -1;
      start = end + 1, end = chunk.indexOf(0, start)
    ) {
      pending.push(chunk.subarray(start, end));
      const text = Buffer.concat(pending).toString("utf8");
      pending = [];
      // One message per turn of the event loop, as Playwright's own pipe
      // transport delivers them: a reply and the events after it in one
      // chunk must not overtake the code awaiting that reply.
      setImmediate(() => {
        if (closed) return;
        let message: object;
        try {
          message = JSON.parse(text) as object;
        } catch {
          transport.close();
          return;
        }
        transport.onmessage?.(message);
      });
    }
    if (start < chunk.length) pending.push(chunk.subarray(start));
  });
  // A browser that dies breaks its pipes; that is its loss, not ours.
  pipes.toProcess.on("error", lost);
  pipes.fromProcess.on("error", lost);
  pipes.fromProcess.on("close", lost);
  return transport;
}

/** Playwright closes them only once it connected; a failed start must too. */
function releasePipes(pipes: ProcessPipes | undefined): void {
  pipes?.toProcess.destroy();
  pipes?.fromProcess.destroy();
}

function targetFrom({
  browser,
  context,
  page,
  cdp,
  takeStoppedDownloads,
  downloadsKept,
  channel,
  pid,
  viewport,
  pixelDensity,
  closeOwner,
}: {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly cdp: CDPSession;
  readonly takeStoppedDownloads: () => readonly StoppedDownload[];
  readonly downloadsKept: (names: readonly string[]) => void;
  readonly channel: string;
  readonly pid: number | undefined;
  readonly viewport: BrowserViewport;
  readonly pixelDensity: number;
  readonly closeOwner: () => Promise<void>;
}): BrowserTarget {
  let closed = false;
  return {
    pid,
    browserName: channelName(channel),
    automation: () => context,
    takeStoppedDownloads,
    downloadsKept,
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
      // The page's size now, which the agent may have changed since launch.
      const size = page.viewportSize() ?? viewport;
      return { data: shot.data, width: size.width, height: size.height };
    },
    startFrames: async (onFrame: (frame: BrowserFrame) => void) => {
      cdp.on("Page.screencastFrame", (frame) => {
        void cdp
          .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
          .catch(() => undefined);
        const shown = {
          data: frame.data,
          width: frame.metadata.deviceWidth ?? 0,
          height: frame.metadata.deviceHeight ?? 0,
        };
        // One drawn for the size before a resize is left out; the capture
        // taken after each action stands in for it.
        if (drawnAtScale(shown.data, shown, pixelDensity)) onFrame(shown);
      });
      // Uncapped, so a streamed frame is the same picture size as a captured
      // one. Capped at the launch size, a page resized past it would stream
      // scaled-down frames between full-size captures, and the panel would
      // jump between the two on every action.
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: frameQuality,
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

/**
 * The most one browser's downloads may come to, together: a page can send a
 * file of any size, and any number of them.
 */
const defaultMaximumDownloadBytes = 1024 ** 3;

/** How often the folder downloads arrive in is looked at. */
const downloadCheckMs = 1_000;

/**
 * A download as the browser names it in its folder: by its id, and with
 * `.crdownload` while it is still arriving.
 */
const download =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.crdownload)?$/i;

/**
 * Stops every download still arriving once the browser's downloads together
 * come to more than the most they may. The browser writes a download to disk
 * as it arrives, so one with no end, or many with an end, would fill it. A
 * finished download stays in `folder`, where the automation server copies it
 * from, until that copy is complete; then it is removed, and counts on as the
 * copy. One that cannot be told apart from another of its name still being
 * copied stays, and counts, until the browser closes. Every download arrives in
 * `folder` under its id, whichever page, frame or closed popup started it,
 * and is stopped within about a second of passing the limit; at once where
 * the page that started it reports its progress, which a frame from another
 * site or a popup opened by a download does not. Answers the downloads it
 * stopped since it was last asked, and stops looking once ended.
 */
async function capDownloads(
  browser: Browser,
  context: BrowserContext,
  folder: string,
  maximumBytes: number,
): Promise<{
  readonly take: () => readonly StoppedDownload[];
  readonly kept: (names: readonly string[]) => void;
  readonly end: () => void;
}> {
  const control = await browser.newBrowserCDPSession();
  const names = new Map<string, string>();
  const cancelled = new Set<string>();
  /** The bytes of each download still arriving, as last seen. */
  const arriving = new Map<string, number>();
  /** The bytes of the finished downloads, as last seen in the folder. */
  let finished = 0;
  /** How many downloads of each name the automation server has kept. */
  const keptByName = new Map<string, number>();
  /** How many of each name were removed once kept, and their bytes. */
  const removedByName = new Map<string, number>();
  const removed = new Set<string>();
  let removedBytes = 0;
  const overLimit = () => {
    let total = finished + removedBytes;
    for (const bytes of arriving.values()) total += bytes;
    return total > maximumBytes;
  };
  let stopped: StoppedDownload[] = [];
  const stop = (guid: string) => {
    arriving.delete(guid);
    if (cancelled.has(guid)) return;
    cancelled.add(guid);
    stopped.push({
      name: names.get(guid) ?? "a file",
      limitBytes: maximumBytes,
    });
    void control
      .send("Browser.cancelDownload", { guid })
      .catch(() => undefined);
  };
  const watch = async (page: Page) => {
    const session = await context.newCDPSession(page);
    session.on("Page.downloadWillBegin", (event) => {
      names.set(event.guid, event.suggestedFilename);
    });
    session.on("Page.downloadProgress", (event) => {
      if (event.state !== "inProgress" || cancelled.has(event.guid)) return;
      arriving.set(event.guid, Math.max(event.receivedBytes, event.totalBytes));
      if (overLimit()) stopAll();
    });
    await session.send("Page.enable");
  };
  const stopAll = () => {
    for (const guid of [...arriving.keys()]) stop(guid);
  };
  context.on("page", (page) => void watch(page).catch(() => undefined));
  await Promise.all(context.pages().map(watch));
  let looking = false;
  const look = async () => {
    if (looking) return;
    looking = true;
    try {
      let finishedNow = 0;
      const arrivingNow = new Set<string>();
      /** The finished downloads still here, by the name their page gave. */
      const finishedByName = new Map<
        string,
        { guid: string; size: number }[]
      >();
      for (const entry of await readdir(folder).catch((): string[] => [])) {
        const named = download.exec(entry);
        const guid = named?.[1];
        if (!guid || cancelled.has(guid) || removed.has(guid)) continue;
        const size = await stat(join(folder, entry)).then(
          (found) => found.size,
          () => 0,
        );
        if (!named[2]) {
          finishedNow += size;
          const name = names.get(guid);
          if (name !== undefined)
            finishedByName.set(name, [
              ...(finishedByName.get(name) ?? []),
              { guid, size },
            ]);
        } else {
          arrivingNow.add(guid);
          arriving.set(guid, Math.max(arriving.get(guid) ?? 0, size));
        }
      }
      // Each finished download of a name whose copies are all complete goes;
      // which of several is still being copied cannot be told, so they stay.
      for (const [name, here] of finishedByName) {
        const waiting =
          (keptByName.get(name) ?? 0) - (removedByName.get(name) ?? 0);
        if (here.length > waiting) continue;
        for (const { guid, size } of here) {
          const gone = await rm(join(folder, guid)).then(
            () => true,
            () => false,
          );
          if (!gone) continue;
          removed.add(guid);
          removedBytes += size;
          finishedNow -= size;
          removedByName.set(name, (removedByName.get(name) ?? 0) + 1);
        }
      }
      finished = finishedNow;
      for (const guid of [...arriving.keys()])
        if (!arrivingNow.has(guid)) arriving.delete(guid);
      if (overLimit()) stopAll();
    } finally {
      looking = false;
    }
  };
  const timer = setInterval(() => void look(), downloadCheckMs);
  return {
    take: () => {
      const taken = stopped;
      stopped = [];
      return taken;
    },
    kept: (kept) => {
      for (const name of kept)
        keptByName.set(name, (keptByName.get(name) ?? 0) + 1);
      if (kept.length) void look();
    },
    end: () => clearInterval(timer),
  };
}

async function connectedTarget(
  browser: Browser,
  channel: string,
  pid: number | undefined,
  viewport: BrowserViewport,
  pixelDensity: number,
  maximumDownloadBytes: number,
  downloads: string,
  closeOwner: () => Promise<void>,
): Promise<BrowserTarget> {
  const context =
    browser.contexts()[0] ?? (await browser.newContext({ viewport }));
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize(viewport);
  const capped = await capDownloads(
    browser,
    context,
    downloads,
    maximumDownloadBytes,
  );
  // Until a target owns it, the watch on downloads is ended here.
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.enable");
    return targetFrom({
      browser,
      context,
      page,
      cdp,
      takeStoppedDownloads: capped.take,
      downloadsKept: capped.kept,
      channel,
      pid,
      viewport,
      pixelDensity,
      closeOwner: async () => {
        capped.end();
        await closeOwner();
      },
    });
  } catch (error) {
    capped.end();
    throw error;
  }
}

async function atomicLaunch(
  containment: BrowserContainment,
  viewport: BrowserViewport,
  pixelDensity: number,
  maximumDownloadBytes: number,
): Promise<BrowserTarget> {
  const container = containment.open();
  const directory = await mkdtemp(
    join(tmpdir(), `zhiyin-browser-${process.pid}-`),
  );
  const profile = join(directory, "profile");
  // Where downloads arrive, before the automation server keeps them in the
  // conversation's folder.
  const downloads = join(directory, "downloads");
  const stdout = join(directory, "stdout.txt");
  const stderr = join(directory, "stderr.txt");
  const selected = installedBrowser();
  let owned: ReturnType<typeof container.launch> | undefined;
  let browser: Browser | undefined;
  try {
    owned = container.launch({
      executable: selected.path,
      arguments: [
        "--headless=new",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        // Nothing the machine registered runs beside the driven page: no
        // extension, no built-in one with a background page, no default app.
        // The same switches Playwright passes when it launches a browser.
        "--disable-extensions",
        "--disable-component-extensions-with-background-pages",
        "--disable-default-apps",
        // A scroll lands at once even on a page styled `scroll-behavior:
        // smooth`, so a position read or a picture taken after it shows where
        // the page went, not a frame of the animation.
        "--disable-smooth-scrolling",
        // Drawn at the density of the screen the panel is on, so its text is
        // as sharp as the app's own. The page still lays out at its own size,
        // and that is the size every frame reports.
        `--force-device-scale-factor=${pixelDensity}`,
        `--window-size=${viewport.width},${viewport.height}`,
        "about:blank",
      ],
      pipes: (ends) => [
        "--remote-debugging-pipe",
        `--remote-debugging-io-pipes=${ends.reads},${ends.writes}`,
      ],
      cwd: directory,
      stdout,
      stderr,
    });
    const exited = owned.wait();
    if (!owned.pipes) throw new Error("The browser was started without pipes.");
    browser = await chromium.connectOverCDP(pipeTransport(owned.pipes), {
      artifactsDir: downloads,
    });
    return await connectedTarget(
      browser,
      selected.channel,
      owned.pid,
      viewport,
      pixelDensity,
      maximumDownloadBytes,
      downloads,
      async () => {
        container.close();
        await exited.catch(() => undefined);
        await browser?.close().catch(() => undefined);
        releasePipes(owned?.pipes);
        await rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 50,
        });
      },
    );
  } catch (error) {
    const ended = owned ? await endedBy(owned, stderr) : undefined;
    container.close();
    await owned?.wait().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    releasePipes(owned?.pipes);
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 50,
    }).catch(() => undefined);
    throw ended ?? error;
  }
}

/**
 * Why a browser that failed to start ended, when it ended on its own: its exit
 * code and the end of what it printed, read before its folder is removed.
 * Playwright can only say the pipe closed, which names no cause.
 */
async function endedBy(
  owned: { wait(): Promise<number> },
  stderr: string,
): Promise<Error | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const code = await Promise.race([
    owned.wait().catch(() => undefined),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), 2_000);
    }),
  ]);
  clearTimeout(timer);
  if (code === undefined) return undefined;
  const printed = (await readFile(stderr, "utf8").catch(() => ""))
    .trim()
    .split(/\r?\n/)
    .slice(-6)
    .join(" ")
    .slice(-600);
  return new Error(
    `The browser ended before it could be driven, with exit code ${code}${printed ? `: ${printed}` : "."}`,
  );
}

export function playwrightBrowserLauncher(
  containment: BrowserContainment,
  options: {
    /** Device pixels per CSS pixel of the screen the panel is shown on. */
    readonly pixelDensity?: () => number;
    /** The most one browser's downloads may come to, together. */
    readonly maximumDownloadBytes?: number;
  } = {},
): BrowserLauncher {
  const density = () => {
    const asked = options.pixelDensity?.() ?? 1;
    return Number.isFinite(asked) ? Math.min(4, Math.max(1, asked)) : 1;
  };
  let cleared: Promise<void> | undefined;
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
    launch: async (viewport) => {
      // Once a run, before its first browser: what a killed Zhiyin left.
      await (cleared ??= clearAbandonedProfiles(tmpdir()));
      return atomicLaunch(
        containment,
        viewport,
        density(),
        options.maximumDownloadBytes ?? defaultMaximumDownloadBytes,
      );
    },
  };
}
