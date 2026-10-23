/**
 * A browser writes each download to disk as it arrives, so what one
 * browser's downloads come to is capped: a page's progress reports stop them
 * at once, and a look at their folder each second stops the rest. Here the
 * browser is a stand-in, so its folder is looked at only when the test says a
 * second has passed.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Browser, BrowserContext } from "playwright-core";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { capDownloads } from "../src/download-cap.js";
import { connectedTarget } from "../src/playwright-launcher.js";

const folders = new TemporaryFolders();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(async () => {
  vi.useRealTimers();
  await folders.removeAll();
});

const firstDownload = "0f8fad5b-d9cb-469f-a165-70867728950e";
const secondDownload = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

type Handler = (event: Record<string, unknown>) => void;

/**
 * A browser with one page, whose cancels of a download are never answered.
 * One that `failsItsPageSession` cannot open the session its page is driven
 * through, as when the page closes during the launch.
 */
function standInBrowser(options: { failsItsPageSession?: boolean } = {}) {
  const cancelled: string[] = [];
  const pageSessions: Map<string, Handler[]>[] = [];
  const page = { setViewportSize: async () => undefined };
  const context = {
    pages: () => [page],
    on: () => undefined,
    newCDPSession: async () => {
      // The first session watches the page's downloads; the next drives it.
      if (options.failsItsPageSession && pageSessions.length === 1)
        throw new Error("The page closed.");
      const handlers = new Map<string, Handler[]>();
      pageSessions.push(handlers);
      return {
        on: (name: string, handler: Handler) =>
          handlers.set(name, [...(handlers.get(name) ?? []), handler]),
        send: async () => ({}),
      };
    },
  };
  const browser = {
    contexts: () => [context],
    newBrowserCDPSession: async () => ({
      send: (method: string, params: { guid: string }) => {
        if (method === "Browser.cancelDownload") cancelled.push(params.guid);
        return new Promise(() => undefined);
      },
    }),
  };
  return {
    browser: browser as unknown as Browser,
    context: context as unknown as BrowserContext,
    cancelled,
    /** The page reporting an event of its downloads. */
    reports: (name: string, event: Record<string, unknown>) => {
      for (const handler of pageSessions[0]?.get(name) ?? []) handler(event);
    },
  };
}

/** A second passing, which starts a look at the folder if one is due. */
function aSecondPasses() {
  vi.advanceTimersByTime(1_000);
}

/** Waits, up to five seconds, for `done` to hold. */
async function until(done: () => boolean) {
  for (let waited = 0; !done() && waited < 5_000; waited += 20)
    await new Promise((resolve) => setTimeout(resolve, 20));
}

/** A download, still arriving, of `bytes` bytes in `folder`. */
async function arriving(folder: string, guid: string, bytes: number) {
  await writeFile(join(folder, `${guid}.crdownload`), Buffer.alloc(bytes));
}

function launch(
  stand: ReturnType<typeof standInBrowser>,
  folder: string,
  maximumBytes: number,
) {
  return connectedTarget(
    stand.browser,
    "msedge",
    undefined,
    { width: 800, height: 600 },
    1,
    maximumBytes,
    folder,
    async () => undefined,
  );
}

it("stops a download at once when its page reports it past the limit, and records it before the browser answers the stop", async () => {
  const stand = standInBrowser();
  const folder = await folders.make("zhiyin-downloads-");
  const cap = await capDownloads(stand.browser, stand.context, folder, 10);

  stand.reports("Page.downloadWillBegin", {
    guid: firstDownload,
    suggestedFilename: "film.mp4",
  });
  stand.reports("Page.downloadProgress", {
    guid: firstDownload,
    state: "inProgress",
    receivedBytes: 11,
    totalBytes: 0,
  });

  // No second has passed, so the folder was never looked at.
  expect(stand.cancelled).toEqual([firstDownload]);
  expect(cap.take()).toEqual([{ name: "film.mp4", limitBytes: 10 }]);
  cap.end();
});

it("stops looking at the downloads folder once the browser closes", async () => {
  const stand = standInBrowser();
  const folder = await folders.make("zhiyin-downloads-");
  const target = await launch(stand, folder, 10);

  await arriving(folder, firstDownload, 11);
  aSecondPasses();
  await until(() => stand.cancelled.length > 0);
  expect(stand.cancelled).toEqual([firstDownload]);

  await target.close();
  // Nothing is left to start another look.
  expect(vi.getTimerCount()).toBe(0);
  await arriving(folder, secondDownload, 11);
  aSecondPasses();
  expect(stand.cancelled).toEqual([firstDownload]);
});

it("stops looking at the downloads folder when the launch fails after the look began", async () => {
  const stand = standInBrowser({ failsItsPageSession: true });
  const folder = await folders.make("zhiyin-downloads-");

  await expect(launch(stand, folder, 10)).rejects.toThrow("The page closed.");

  // Nothing is left to start a look.
  expect(vi.getTimerCount()).toBe(0);
  await arriving(folder, firstDownload, 11);
  aSecondPasses();
  expect(stand.cancelled).toEqual([]);
});
