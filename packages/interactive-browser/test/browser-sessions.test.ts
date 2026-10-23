import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { BrowserSessions, type InteractiveBrowser } from "../src/index.js";

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

function fakeBrowser(): InteractiveBrowser & {
  close: ReturnType<typeof vi.fn>;
} {
  return {
    availability: async () => ({ available: true, browserName: "Test" }),
    state: () => ({ status: "closed", url: "", title: "", loading: false }),
    open: async () => {},
    close: vi.fn(async () => {}),
    takeStoppedDownloads: () => [],
    navigate: async () => {},
    back: async () => {},
    forward: async () => {},
    reload: async () => {},
    click: async () => {},
    typeText: async () => {},
    pressKey: async () => {},
    scroll: async () => {},
    refresh: async () => {},
    automation: () => undefined,
    lastFrame: () => undefined,
    onFrame: () => () => {},
    onState: () => () => {},
    markAgentAction: () => {},
    onAgentAction: () => () => {},
    watch: async () => {},
  };
}
