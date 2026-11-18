/**
 * The production browser: Edge when it is there, Chrome otherwise, headless
 * and on a profile of its own. Production starts it suspended, assigns its Job
 * Object, then resumes it, so its first instruction cannot create an escapee.
 * It is driven over two pipes only Zhiyin holds, never a port: the DevTools
 * protocol has no authentication, so a port would let any program on the
 * machine drive it (ADR 0018).
 */

import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Serial } from "@zhiyin/one-at-a-time";
import type {
  Browser,
  BrowserContext,
  CDPSession,
  ConnectOverCDPTransport,
  Page,
} from "playwright-core";
import type { ProcessPipes } from "@zhiyin/sandbox";
import { clearAbandonedProfiles } from "./abandoned-profiles.js";
import { capDownloads } from "./download-cap.js";
import { drawnAtScale } from "./frame-scale.js";
import { NetworkGate, type NetworkGateOptions } from "./network-gate.js";
import type {
  BrowserAvailability,
  BrowserContainment,
  BrowserFrame,
  BrowserLauncher,
  BrowserNetwork,
  BrowserTarget,
  BrowserView,
  BrowserViewport,
  StoppedDownload,
} from "./interactive-browser.js";

const channels = ["msedge", "chrome"] as const;
const frameQuality = 80;
/** The page feed passes about fifteen pictures a second while watched. */
const frameIntervalMs = 66;

/** The DevTools protocol's mouse event for each step of a pointer. */
const mouseEvents = {
  press: "mousePressed",
  move: "mouseMoved",
  release: "mouseReleased",
} as const;

/** The most characters of a page's selection a copy takes. */
const longestCopy = 1_000_000;

/** The protocol's bits for a held button and a held key. */
const buttonBits = { left: 1, right: 2 } as const;
const keyBits = { Alt: 1, Control: 2, Shift: 8 } as const;

/**
 * Run in each frame: the text selected there, in the field that has the focus
 * when it is one a person types into, else in the document; and whether this
 * frame holds the focus itself rather than through a frame inside it. A
 * password field's text is never read, as a browser never copies it.
 */
const readSelection = `(() => {
  const active = document.activeElement;
  const focused =
    document.hasFocus() &&
    !(active instanceof HTMLIFrameElement || active instanceof HTMLFrameElement);
  let text = "";
  const field =
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && active.type !== "password");
  if (field) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start !== null && end !== null && end > start)
      text = active.value.slice(start, end);
  }
  if (!text && !(active instanceof HTMLInputElement && active.type === "password"))
    text = String(document.getSelection() ?? "");
  return { focused, text };
})()`;

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

/**
 * An address as the proxy names what it refused: `http` for plain requests
 * and WebSockets, `https` for secure ones, the port always said.
 */
function proxyOrigin(url: string): string | undefined {
  try {
    const { protocol, hostname, port } = new URL(url);
    const scheme =
      protocol === "http:" || protocol === "ws:"
        ? "http"
        : protocol === "https:" || protocol === "wss:"
          ? "https"
          : undefined;
    if (!scheme) return undefined;
    return `${scheme}://${hostname.toLowerCase()}:${port || (scheme === "https" ? 443 : 80)}`;
  } catch {
    return undefined;
  }
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
  network,
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
  readonly network: BrowserNetwork | undefined;
  readonly closeOwner: () => Promise<void>;
}): BrowserTarget {
  let closed = false;
  /** Whether the page waits on a dialog it showed. */
  let asking = false;
  cdp.on("Page.javascriptDialogOpening", () => (asking = true));
  cdp.on("Page.javascriptDialogClosed", () => (asking = false));
  /** The panel the page streams for, while one watches. */
  let streamingAt: BrowserView | undefined;
  /** Changes to the stream, made one at a time, so the last asked holds. */
  const streaming = new Serial();
  const restream = async (view: BrowserView | undefined) => {
    if (streamingAt) await cdp.send("Page.stopScreencast");
    streamingAt = view;
    if (!view) return;
    // Fitted into the panel, as a capture for it is, so the two are the
    // same picture size; a page smaller than the panel keeps its own.
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: frameQuality,
      maxWidth: view.width,
      maxHeight: view.height,
      everyNthFrame: 2,
    });
  };
  /**
   * Every origin the browser's pages and workers asked for, as the proxy
   * names it. What the browser asks for on its own, such as its maker's
   * services, is refused too while the preview is held, but is not the page's
   * and is not told as such.
   */
  const asked = new Set<string>();
  context.on("request", (request) => {
    const origin = proxyOrigin(request.url());
    if (origin && asked.size < 10_000) asked.add(origin);
  });
  const pagesNetwork: BrowserNetwork | undefined = network && {
    preview: (isPreview) => network.preview(isPreview),
    page: (isAt) => network.page(isAt),
    sealed: () => network.sealed(),
    leave: () => network.leave(),
    allow: (origins) => network.allow(origins),
    takeRefused: () =>
      network.takeRefused().filter((origin) => asked.has(origin)),
  };
  return {
    pid,
    browserName: channelName(channel),
    network: pagesNetwork,
    historyEntry: async (delta) => {
      const { currentIndex, entries } = await cdp.send(
        "Page.getNavigationHistory",
      );
      return entries[currentIndex + delta]?.url;
    },
    endOrigins: async (origins) => {
      await page.goto("about:blank");
      // A page the preview opened runs on after the panel's page leaves it.
      for (const other of context.pages())
        if (other !== page) await other.close();
      // A worker removed runs on until stopped, so every one is stopped;
      // a site's own starts again when its page needs it.
      for (const origin of origins)
        await cdp.send("Storage.clearDataForOrigin", {
          origin,
          storageTypes: "service_workers",
        });
      await cdp.send("ServiceWorker.enable");
      await cdp.send("ServiceWorker.stopAllWorkers");
      await cdp.send("ServiceWorker.disable");
    },
    // Asked on Zhiyin's own session, which a script holding the page leaves
    // unanswered; stopping it is one of the few calls the browser takes
    // even then, as it interrupts the script rather than waiting on it.
    watchedPage: {
      answers: () => cdp.send("Runtime.evaluate", { expression: "0" }),
      stop: () => cdp.send("Runtime.terminateExecution"),
      asking: () => asking,
    },
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
    pointer: async ({ action, x, y, button, clicks, keys }) => {
      await cdp.send("Input.dispatchMouseEvent", {
        type: mouseEvents[action],
        x,
        y,
        button: button ?? "none",
        // The buttons held once this has happened: none after a release.
        buttons: button && action !== "release" ? buttonBits[button] : 0,
        clickCount: clicks,
        modifiers: keys.reduce((bits, key) => bits | keyBits[key], 0),
      });
    },
    typeText: async (text) => {
      await cdp.send("Input.insertText", { text });
    },
    pressKey: async (key) => {
      await page.keyboard.press(key);
    },
    scroll: async (x, y, deltaX, deltaY) => {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        deltaX,
        deltaY,
      });
    },
    selectedText: async () => {
      const read: { focused: boolean; text: string }[] = [];
      // The main frame first, then the frames inside it.
      for (const frame of page.frames()) {
        try {
          // The page answers, and a page can answer anything: only a flag
          // and text are taken, and no more text than a person would copy.
          const answer: unknown = await frame.evaluate(readSelection);
          if (typeof answer !== "object" || answer === null) continue;
          const { focused, text } = answer as Record<string, unknown>;
          if (typeof focused === "boolean" && typeof text === "string")
            read.push({ focused, text: text.slice(0, longestCopy) });
        } catch {
          // A frame that went, or will not answer, has no selection to give.
        }
      }
      // The frame with the focus answers, even with nothing selected: another
      // frame keeps a selection the person has since left. Only a page with
      // no focus anywhere is answered from the first frame with a selection.
      const focused = read.find((each) => each.focused);
      return focused
        ? focused.text
        : (read.find((each) => each.text)?.text ?? "");
    },
    captureFrame: async () => {
      // The page's size now, which the agent may have changed since launch.
      const size = page.viewportSize() ?? viewport;
      // The whole page as drawn, with no clip: Chromium draws a clipped
      // picture by changing the page's size on this session and, after,
      // puts back this session's size, which is none, undoing the size the
      // agent gave the page on Playwright's.
      const shot = await cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: frameQuality,
      });
      return { data: shot.data, width: size.width, height: size.height };
    },
    startFrames: async (onFrame: (frame: BrowserFrame) => void) => {
      // Chromium sends the next frame only once this one is acknowledged, so
      // holding the acknowledgement keeps a page that animates to a few
      // pictures a second, encoded at that rate rather than dropped after.
      let nextAck = 0;
      cdp.on("Page.screencastFrame", (frame) => {
        const now = Date.now();
        const wait = Math.max(0, nextAck - now);
        nextAck = now + wait + frameIntervalMs;
        setTimeout(() => {
          void cdp
            .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
            .catch(() => undefined);
        }, wait);
        const shown = {
          data: frame.data,
          width: frame.metadata.deviceWidth ?? 0,
          height: frame.metadata.deviceHeight ?? 0,
        };
        // One drawn for the size before a resize is left out; the capture
        // taken after each action stands in for it. So is one of the page
        // stretched to its full length while a picture of all of it is
        // taken: the panel keeps the page at its own size meanwhile.
        const size = page.viewportSize() ?? viewport;
        if (
          shown.width === size.width &&
          shown.height === size.height &&
          drawnAtScale(shown.data, shown, pixelDensity, streamingAt)
        )
          onFrame(shown);
      });
    },
    streamFrames: (view: BrowserView | undefined) =>
      streaming.run(() => restream(view)),
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

export async function connectedTarget(
  browser: Browser,
  channel: string,
  pid: number | undefined,
  viewport: BrowserViewport,
  pixelDensity: number,
  maximumDownloadBytes: number,
  downloads: string,
  closeOwner: () => Promise<void>,
  network?: BrowserNetwork,
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
      network,
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
  network: NetworkGateOptions,
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
  // Every connection the browser makes goes through Zhiyin (ADR 0018).
  const gate = new NetworkGate(network);
  try {
    const proxy = await gate.start();
    // WebRTC sends its UDP past any proxy unless the profile says not to
    // before the browser first starts; its launch switch does not hold.
    await mkdir(join(profile, "Default"), { recursive: true });
    await writeFile(
      join(profile, "Default", "Preferences"),
      JSON.stringify({
        webrtc: {
          ip_handling_policy: "disable_non_proxied_udp",
          multiple_routes_enabled: false,
          nonproxied_udp_enabled: false,
        },
      }),
    );
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
        // Every connection through Zhiyin's proxy, those to this computer
        // included, and none over QUIC, which a proxy does not carry. A page
        // is never kept to be shown again without asking the network: one
        // shown from that cache would run with no request for the proxy to see.
        `--proxy-server=http://127.0.0.1:${proxy}`,
        "--proxy-bypass-list=<-loopback>",
        "--disable-quic",
        "--disable-features=BackForwardCache",
        // The browser's own calls home, which a page did not ask for: most
        // stop with these, the switches Playwright launches with.
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-domain-reliability",
        "--no-pings",
        "--metrics-recording-only",
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
    // Loaded only now: most launches of the app never open a browser, and a
    // library loaded with the app is loaded before its window.
    const { chromium } = await import("playwright-core");
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
        await gate.close();
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
      gate,
    );
  } catch (error) {
    const ended = owned ? await endedBy(owned, stderr) : undefined;
    container.close();
    await owned?.wait().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    releasePipes(owned?.pipes);
    await gate.close();
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
    /**
     * How the browser's proxy looks names up and which addresses it reaches.
     * Swapped in tests, so a server here can stand in for a site on the
     * internet; production uses this machine's resolver and the internet.
     */
    readonly network?: NetworkGateOptions;
  } = {},
): BrowserLauncher {
  const density = () => {
    const asked = options.pixelDensity?.() ?? 1;
    return Number.isFinite(asked) ? Math.min(4, Math.max(1, asked)) : 1;
  };
  let cleared: Promise<void> | undefined;
  return {
    sealsPreview: true,
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
        options.network ?? {},
      );
    },
  };
}
