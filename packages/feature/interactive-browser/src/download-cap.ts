/**
 * The limit on what one browser's downloads may come to: the browser writes
 * each to disk as it arrives, whichever page started it.
 */

import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { StoppedDownload } from "./interactive-browser.js";

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
export async function capDownloads(
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
