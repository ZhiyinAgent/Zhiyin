import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { BrowserSessions, type InteractiveBrowser } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

describe("conversation browser sessions", () => {
  it("takes a conversation's browser folder, its downloads among it, away with the conversation", async () => {
    const parent = await folders.make("zhiyin-browser-output-");
    const folderOf = (conversationId: string) => join(parent, conversationId);
    for (const conversationId of ["first", "second"]) {
      await mkdir(folderOf(conversationId));
      await writeFile(join(folderOf(conversationId), "report.pdf"), "pdf");
    }
    const sessions = new BrowserSessions(() => fakeBrowser(), {
      outputDirectory: folderOf,
    });
    sessions.browser("first");
    sessions.browser("second");

    await sessions.close("second");
    await sessions.forget("first");

    expect(await readdir(parent)).toEqual(["second"]);
  });

  it("keeps a different browser session for each conversation and closes only its owner", async () => {
    const created = new Map<string, ReturnType<typeof fakeBrowser>>();
    const sessions = new BrowserSessions((conversationId) => {
      const browser = fakeBrowser();
      created.set(conversationId, browser);
      return browser;
    });

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
  };
}
