import { describe, expect, it, vi } from "vitest";
import {
  BrowserSession,
  type BrowserAvailability,
  type BrowserFrame,
  type BrowserLauncher,
  type BrowserTarget,
} from "../src/index.js";

type FakeBrowser = {
  readonly launcher: BrowserLauncher;
  readonly target: BrowserTarget;
  readonly launches: () => number;
  navigateTo(url: string, title?: string): Promise<void>;
  emitFrame(frame?: Partial<BrowserFrame>): void;
  lose(): void;
  readonly closed: () => boolean;
};

function fakeBrowser(
  overrides: {
    readonly pid?: number | undefined;
    readonly available?: BrowserAvailability;
    readonly launchError?: Error;
  } = {},
): FakeBrowser {
  let url = "about:blank";
  let title = "";
  let launches = 0;
  let closed = false;
  let onFrame: ((frame: BrowserFrame) => void) | undefined;
  let navigated: (() => void) | undefined;
  let lost: (() => void) | undefined;
  const context = { marker: "the automation context" };

  const target: BrowserTarget = {
    pid: "pid" in overrides ? overrides.pid : 4242,
    browserName: "Microsoft Edge",
    automation: () => context,
    url: () => url,
    title: async () => title,
    goto: async (next) => {
      url = next;
    },
    back: async () => {},
    forward: async () => {},
    reload: async () => {},
    click: async () => {},
    typeText: async () => {},
    pressKey: async () => {},
    scroll: async () => {},
    captureFrame: async () => ({
      data: `captured:${url}`,
      width: 800,
      height: 600,
    }),
    startFrames: async (listener) => {
      onFrame = listener;
    },
    onNavigated: (listener) => {
      navigated = listener;
    },
    onLost: (listener) => {
      lost = listener;
    },
    close: async () => {
      closed = true;
    },
  };

  return {
    target,
    launches: () => launches,
    closed: () => closed,
    launcher: {
      available: async () =>
        overrides.available ?? {
          available: true,
          browserName: "Microsoft Edge",
        },
      launch: async () => {
        launches += 1;
        if (overrides.launchError) throw overrides.launchError;
        return target;
      },
    },
    navigateTo: async (next, nextTitle = "") => {
      url = next;
      title = nextTitle;
      navigated?.();
      await Promise.resolve();
    },
    emitFrame: (frame) =>
      onFrame?.({ data: "AAAA", width: 800, height: 600, ...frame }),
    lose: () => lost?.(),
  };
}

describe("BrowserSession", () => {
  it("closes a browser whose launch completes after close was requested", async () => {
    const fake = fakeBrowser();
    let finish!: (target: BrowserTarget) => void;
    const session = new BrowserSession({
      launcher: {
        ...fake.launcher,
        launch: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    });
    const opening = session.open();
    const closing = session.close();
    finish(fake.target);
    await Promise.all([opening, closing]);
    expect(session.state().status).toBe("closed");
    expect(session.automation()).toBeUndefined();
    expect(fake.closed()).toBe(true);
  });
  it("starts closed and says so", () => {
    const session = new BrowserSession({ launcher: fakeBrowser().launcher });
    expect(session.state()).toEqual({
      status: "closed",
      url: "",
      title: "",
      loading: false,
    });
    expect(session.automation()).toBeUndefined();
  });

  it("opens a page and reports where it is", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });

    await session.open("https://example.com/");

    expect(session.state()).toMatchObject({
      status: "open",
      url: "https://example.com/",
      loading: false,
    });
  });

  it("reports a browser that will not start instead of pretending", async () => {
    const fake = fakeBrowser({
      launchError: new Error("Edge is not installed"),
    });
    const session = new BrowserSession({ launcher: fake.launcher });

    await session.open("https://example.com/");

    expect(session.state()).toMatchObject({ status: "failed" });
    expect(session.state().reason).toContain("Edge is not installed");
  });

  it("never launches a second browser for a second opener", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });

    await Promise.all([
      session.open("https://one.example/"),
      session.open(),
      session.open(),
    ]);
    await session.open("https://two.example/");

    expect(fake.launches()).toBe(1);
    expect(session.state().url).toBe("https://two.example/");
  });

  it("follows the page when the page navigates itself", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open("https://example.com/");

    await fake.navigateTo("https://example.com/next", "Next page");
    await vi.waitFor(() =>
      expect(session.state()).toMatchObject({
        url: "https://example.com/next",
        title: "Next page",
      }),
    );
  });

  it("hands the agent the same session the person is watching", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open();

    expect(session.automation()).toBe(fake.target.automation());
  });

  it("has a frame after opening, without waiting for the page to repaint", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    const seen: string[] = [];
    session.onFrame((frame) => seen.push(frame.data));

    // Nothing emits a screencast frame here. A panel that only drew on repaint
    // would be blank, which is the failure this guards.
    await session.open("https://example.com/");

    expect(seen).toEqual(["captured:https://example.com/"]);
    expect(session.lastFrame()).toMatchObject({
      data: "captured:https://example.com/",
    });
  });

  it("draws a fresh frame after a person acts on the page", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open("https://example.com/");
    const seen: string[] = [];
    session.onFrame((frame) => seen.push(frame.data));

    await session.click(10, 10);
    await session.navigate("https://example.com/next");

    expect(seen).toEqual([
      "captured:https://example.com/",
      "captured:https://example.com/next",
    ]);
  });

  it("keeps the latest frame for a panel that arrives late", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open();

    fake.emitFrame({ data: "first" });
    fake.emitFrame({ data: "second" });

    expect(session.lastFrame()).toMatchObject({ data: "second" });
  });

  it("delivers frames to watchers until they stop watching", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open();
    const seen: string[] = [];
    const stop = session.onFrame((frame) => seen.push(frame.data));

    fake.emitFrame({ data: "one" });
    stop();
    fake.emitFrame({ data: "two" });

    expect(seen).toEqual(["one"]);
  });

  it("announces each state change to whoever is listening", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    const states: string[] = [];
    session.onState((state) => states.push(state.status));

    await session.open("https://example.com/");
    await session.close();

    expect(states).toEqual(["opening", "open", "closed"]);
  });

  it("says the browser is gone when it closes on its own", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open();

    fake.lose();

    await vi.waitFor(() =>
      expect(session.state()).toMatchObject({
        status: "failed",
        reason: "The browser closed unexpectedly.",
      }),
    );
    expect(session.automation()).toBeUndefined();
    expect(session.lastFrame()).toBeUndefined();
  });

  it("refuses to act on a browser that is not open", async () => {
    const session = new BrowserSession({ launcher: fakeBrowser().launcher });
    await expect(session.click(1, 1)).rejects.toThrow(
      "The browser is not open.",
    );
    await expect(session.navigate("https://example.com/")).rejects.toThrow(
      "The browser is not open.",
    );
  });

  it("passes a person's clicks and typing to the page", async () => {
    const fake = fakeBrowser();
    const click = vi.spyOn(fake.target, "click");
    const typeText = vi.spyOn(fake.target, "typeText");
    const pressKey = vi.spyOn(fake.target, "pressKey");
    const scroll = vi.spyOn(fake.target, "scroll");
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open();

    await session.click(12, 34);
    await session.typeText("hej");
    await session.pressKey("Enter");
    await session.scroll(5, 6, 120);

    expect(click).toHaveBeenCalledWith(12, 34);
    expect(typeText).toHaveBeenCalledWith("hej");
    expect(pressKey).toHaveBeenCalledWith("Enter");
    expect(scroll).toHaveBeenCalledWith(5, 6, 120);
  });

  it("reports an unavailable browser with the reason it gave", async () => {
    const fake = fakeBrowser({
      available: { available: false, reason: "No supported browser." },
    });
    const session = new BrowserSession({ launcher: fake.launcher });
    await expect(session.availability()).resolves.toEqual({
      available: false,
      reason: "No supported browser.",
    });
  });

  it("closes harmlessly when nothing was ever opened", async () => {
    const session = new BrowserSession({ launcher: fakeBrowser().launcher });
    await expect(session.close()).resolves.toBeUndefined();
    expect(session.state().status).toBe("closed");
  });
});
