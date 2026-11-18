/**
 * A browser for tests of the held preview (ADR 0018): it writes down each
 * thing done to it, in order, and its network holds the page to the preview
 * from the first time the page goes to the preview's address.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TemporaryFolders } from "@zhiyin/test-support";
import {
  BrowserSession,
  type BrowserLauncher,
  type BrowserNetwork,
  type BrowserTarget,
} from "../src/index.js";
import type { WatchedPage } from "../src/busy-page.js";

/** A page that answers at once, so no watch ever stops its script. */
export const answeringPage: WatchedPage = {
  answers: async () => {},
  stop: async () => {},
  asking: () => false,
};

/** A browser that writes down what is done to it, its network held as told. */
export function heldBrowser(history: { back?: string; forward?: string } = {}) {
  const done: string[] = [];
  let url = "about:blank";
  let isPreview: (hostPort: string) => boolean = () => false;
  let pageAt: (hostPort: string) => boolean = () => false;
  /** Whether the page was at, or sent to, each address when it was asked for. */
  const sentTo: string[] = [];
  let sealed: string[] = [];
  let refused: string[] = [];
  const network: BrowserNetwork = {
    preview: (given) => {
      isPreview = given;
    },
    page: (given) => {
      pageAt = given;
    },
    sealed: () => sealed,
    leave: () => {
      done.push("let out");
      sealed = [];
    },
    allow: (origins) => {
      done.push(`allow ${origins.join(" ")}`);
      return [];
    },
    takeRefused: () => {
      const taken = refused;
      refused = [];
      return taken;
    },
  };
  const target: BrowserTarget = {
    pid: 1,
    browserName: "Microsoft Edge",
    network,
    watchedPage: answeringPage,
    automation: () => ({}),
    takeStoppedDownloads: () => [],
    downloadsKept: () => {},
    url: () => url,
    title: async () => "",
    goto: async (next) => {
      done.push(`go to ${next}`);
      const asked = new URL(next);
      if (asked.protocol.startsWith("http")) {
        const at = `${asked.hostname}:${asked.port || (asked.protocol === "https:" ? 443 : 80)}`;
        sentTo.push(`${at} ${pageAt(at)}`);
      }
      url = next;
      // The page asking for the preview is what holds the browser to it.
      const at = new URL(next).host;
      if (isPreview(at)) sealed = [...new Set([...sealed, at])];
    },
    back: async () => {
      done.push("back");
    },
    forward: async () => {
      done.push("forward");
    },
    reload: async () => {},
    pointer: async () => {},
    typeText: async () => {},
    pressKey: async () => {},
    scroll: async () => {},
    selectedText: async () => "",
    captureFrame: async () => ({ data: "", width: 1, height: 1 }),
    startFrames: async () => {},
    streamFrames: async () => {},
    onNavigated: () => {},
    onLost: () => {},
    historyEntry: async (delta) =>
      delta === -1 ? history.back : history.forward,
    endOrigins: async (origins) => {
      done.push(`end ${origins.join(" ")}`);
    },
    close: async () => {},
  };
  const launcher: BrowserLauncher = {
    sealsPreview: true,
    available: async () => ({ available: true, browserName: "Microsoft Edge" }),
    launch: async () => target,
  };
  return {
    launcher,
    done,
    isPreview: (at: string) => isPreview(at),
    pageAt: (at: string) => pageAt(at),
    sentTo,
    refuse: (origin: string) => refused.push(origin),
  };
}

/** A session on `made`, its preview open on a folder holding one page. */
export async function sessionWithPreview(
  made: ReturnType<typeof heldBrowser>,
  folders: TemporaryFolders,
) {
  const folder = await folders.make("zhiyin-preview-seal-");
  await writeFile(join(folder, "index.html"), "<p>notes</p>");
  const session = new BrowserSession({
    launcher: made.launcher,
    workspaceRoot: () => folder,
  });
  const address = await session.preview!.open("index.html");
  await session.open(address);
  made.done.length = 0;
  return { session, address, at: new URL(address).host };
}
