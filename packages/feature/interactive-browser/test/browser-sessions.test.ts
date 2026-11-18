import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { BrowserSessions, type InteractiveBrowser } from "../src/index.js";
import { fakeBrowser as closedBrowser, fakeBrowsers } from "./fakes.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

describe("conversation browser sessions", () => {
  it("takes a conversation's browser folder, its downloads among it, away with the conversation", async () => {
    const root = await folders.make("zhiyin-browser-output-");
    const sessions = new BrowserSessions(() => fakeBrowser(), {
      directory: root,
    });
    const first = "4f1c2a9e-0b7d-4c55-9a43-2d6e8f10b3a7";
    const second = "9b2e7d41-55c0-4e8a-8f36-1a7c0d2e9f64";
    for (const conversationId of [first, second]) {
      await mkdir(sessions.directory(conversationId));
      await writeFile(
        join(sessions.directory(conversationId), "report.pdf"),
        "pdf",
      );
    }
    sessions.browser(first);
    sessions.browser(second);

    await sessions.close(second);
    await sessions.forget(first);

    // Each folder is named by its conversation, so it can be found by eye.
    expect(await readdir(root)).toEqual([second]);
  });

  it("keeps a conversation whose id could name a path inside its own folder", async () => {
    const root = await folders.make("zhiyin-browser-output-");
    const sessions = new BrowserSessions(() => fakeBrowser(), {
      directory: root,
    });

    for (const conversationId of ["..", "../escape", "a/b", "C:\\other"])
      expect(dirname(sessions.directory(conversationId))).toBe(root);
  });

  it("keeps a different browser session for each conversation and closes only its owner", async () => {
    const created = new Map<string, ReturnType<typeof fakeBrowser>>();
    const sessions = new BrowserSessions(
      (conversationId) => {
        const browser = fakeBrowser();
        created.set(conversationId, browser);
        return browser;
      },
      { directory: await folders.make("zhiyin-browser-output-") },
    );

    expect(sessions.browser("first")).toBe(sessions.browser("first"));
    expect(sessions.browser("second")).not.toBe(sessions.browser("first"));

    await sessions.close("first");

    expect(created.get("first")?.close).toHaveBeenCalledOnce();
    expect(created.get("second")?.close).not.toHaveBeenCalled();
  });
});

/*
 * What the tests above this package rely on, held for the app's browsers and
 * for the fake they use in their place (ADR 0002).
 */
describe.each([
  [
    "the app's browsers",
    async (browserFor: (id: string) => InteractiveBrowser) =>
      new BrowserSessions(browserFor, {
        directory: await folders.make("zhiyin-browser-output-"),
      }),
  ],
  [
    "the fake",
    async (browserFor: (id: string) => InteractiveBrowser) =>
      fakeBrowsers(browserFor),
  ],
] as const)("%s", (_, made) => {
  it("keep one browser per conversation, until it is forgotten", async () => {
    const created: string[] = [];
    const browsers = await made((conversationId) => {
      created.push(conversationId);
      return fakeBrowser();
    });

    const first = browsers.browser("first");
    expect(browsers.browser("first")).toBe(first);
    expect(browsers.browser("second")).not.toBe(first);
    await browsers.forget("first");

    expect(browsers.browser("first")).not.toBe(first);
    expect(created).toEqual(["first", "second", "first"]);
  });

  it("close only the conversation's own browser, or every one", async () => {
    const opened = new Map<string, ReturnType<typeof fakeBrowser>>();
    const browsers = await made((conversationId) => {
      const browser = fakeBrowser();
      opened.set(conversationId, browser);
      return browser;
    });
    browsers.browser("first");
    browsers.browser("second");

    await browsers.close("first");
    expect(opened.get("first")?.close).toHaveBeenCalledOnce();
    expect(opened.get("second")?.close).not.toHaveBeenCalled();

    await browsers.closeAll();
    expect(opened.get("second")?.close).toHaveBeenCalledOnce();
  });
});

function fakeBrowser(): InteractiveBrowser & {
  close: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn(async () => {});
  return Object.assign(closedBrowser(), { close });
}
