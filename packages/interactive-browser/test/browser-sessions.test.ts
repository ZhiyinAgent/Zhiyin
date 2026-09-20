import { describe, expect, it, vi } from "vitest";
import { BrowserSessions, type InteractiveBrowser } from "../src/index.js";

describe("conversation browser sessions", () => {
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
  };
}
