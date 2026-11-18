import { describe, expect, it, vi } from "vitest";
import {
  BrowserSession,
  type BrowserAvailability,
  type BrowserFrame,
  type BrowserLauncher,
  type BrowserTarget,
  type BrowserView,
} from "../src/index.js";
import { answeringPage } from "./held-browser.js";

/** The left button going down at a point, with no key held. */
const pressAt = (x: number, y: number) =>
  ({ action: "press", x, y, button: "left", clicks: 1, keys: [] }) as const;

type FakeBrowser = {
  readonly launcher: BrowserLauncher;
  readonly target: BrowserTarget;
  readonly launches: () => number;
  /** Every address the browser itself was sent to. */
  readonly visited: () => readonly string[];
  navigateTo(url: string, title?: string): Promise<void>;
  emitFrame(frame?: Partial<BrowserFrame>): void;
  /** Each size the page was asked to stream at; undefined for none. */
  readonly streamed: () => readonly (BrowserView | undefined)[];
  /** How many pictures were taken. */
  readonly captured: () => number;
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
  const visited: string[] = [];
  let closed = false;
  let onFrame: ((frame: BrowserFrame) => void) | undefined;
  const streamed: (BrowserView | undefined)[] = [];
  let captured = 0;
  let navigated: (() => void) | undefined;
  let lost: (() => void) | undefined;
  const context = { marker: "the automation context" };

  const target: BrowserTarget = {
    pid: "pid" in overrides ? overrides.pid : 4242,
    browserName: "Microsoft Edge",
    network: undefined,
    historyEntry: async () => undefined,
    endOrigins: async () => {},
    watchedPage: answeringPage,
    automation: () => context,
    takeStoppedDownloads: () => [],
    downloadsKept: () => {},
    url: () => url,
    title: async () => title,
    goto: async (next) => {
      visited.push(next);
      url = next;
    },
    back: async () => {},
    forward: async () => {},
    reload: async () => {},
    pointer: async () => {},
    typeText: async () => {},
    pressKey: async () => {},
    scroll: async () => {},
    selectedText: async () => "",
    captureFrame: async () => {
      captured += 1;
      return { data: `captured:${url}`, width: 800, height: 600 };
    },
    startFrames: async (listener) => {
      onFrame = listener;
    },
    streamFrames: async (view) => {
      streamed.push(view);
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
    visited: () => visited,
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
    streamed: () => streamed,
    captured: () => captured,
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

  it("opens only web pages, whoever asks", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open("https://example.com/");

    for (const url of ["view-source:https://example.com/", "edge://settings"]) {
      await expect(session.navigate(url)).rejects.toThrow(/web/);
      await expect(session.open(url)).rejects.toThrow(/web/);
    }
    expect(session.state().url).toBe("https://example.com/");
  });

  // What the person types in the panel reaches the browser through open and
  // navigate, as the agent's addresses do.
  it.each([
    "file:///C:/Users/someone/notes.html",
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
    "blob:https://example.com/0f3c",
    "chrome://settings",
    "edge://settings",
    "about:config",
    "view-source:https://example.com/",
    "ftp://example.com/file",
    "ws://example.com/socket",
  ])("never sends %s to the browser, whoever asks", async (url) => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open("https://example.com/");

    await expect(session.navigate(url)).rejects.toThrow();
    await expect(session.open(url)).rejects.toThrow();

    expect(fake.visited()).toEqual(["https://example.com/"]);
    expect(session.state().url).toBe("https://example.com/");
  });

  it("reads an address typed without its scheme as a web address", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });

    await session.open("example.com/docs");
    expect(session.state().url).toBe("https://example.com/docs");

    await session.navigate("localhost:5173");
    expect(session.state().url).toBe("http://localhost:5173/");
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

    await session.pointer(pressAt(10, 10));
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

  it("streams pictures only while the panel watches, at the panel's size, and takes one after each action", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    const panel = { width: 900, height: 560 };

    await session.open("https://example.com");
    // Nobody is watching yet: a picture after opening, and no stream.
    expect(fake.streamed().filter(Boolean)).toEqual([]);
    expect(fake.captured()).toBe(1);

    await session.watch(panel);
    expect(fake.streamed().at(-1)).toEqual(panel);
    // A picture at once, for the panel that started watching.
    expect(fake.captured()).toBe(2);
    await session.pointer(pressAt(10, 10));
    expect(fake.captured()).toBe(3);

    await session.watch(undefined);
    expect(fake.streamed().at(-1)).toBeUndefined();
    await session.pointer(pressAt(10, 10));
    expect(fake.captured()).toBe(4);
  });

  it("streams at the panel's size from the start when the panel watched before the browser opened", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    const panel = { width: 600, height: 375 };

    await session.watch(panel);
    await session.open("https://example.com");

    expect(fake.streamed().at(-1)).toEqual(panel);
  });

  it("streams at the size watched last when the panel changes while the browser opens", async () => {
    for (const later of [undefined, { width: 1200, height: 700 }]) {
      const fake = fakeBrowser();
      const stream = fake.target.streamFrames;
      let release: (() => void) | undefined;
      // The first stream the browser starts is held until released.
      Object.assign(fake.target, {
        streamFrames: async (view: BrowserView | undefined) => {
          await stream(view);
          if (fake.streamed().length === 1)
            await new Promise<void>((resolve) => (release = resolve));
        },
      });
      const session = new BrowserSession({ launcher: fake.launcher });
      await session.watch({ width: 900, height: 560 });
      const opening = session.open("https://example.com");
      await vi.waitFor(() => expect(release).toBeDefined());

      const watching = session.watch(later);
      release!();
      await Promise.all([opening, watching]);

      expect(fake.streamed().at(-1)).toEqual(later);
    }
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

  it("tells whoever is listening each time the agent acts on the page", () => {
    const session = new BrowserSession({ launcher: fakeBrowser().launcher });
    let told = 0;
    const stop = session.onAgentAction(() => told++);

    session.markAgentAction();
    session.markAgentAction();
    stop();
    session.markAgentAction();

    expect(told).toBe(2);
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

  it("keeps a browser opened while what was left of a lost one was ended", async () => {
    const first = fakeBrowser();
    const second = fakeBrowser();
    let ended = () => {};
    let ending = false;
    const lostTarget: BrowserTarget = {
      ...first.target,
      // What is left of the lost browser takes a while to end.
      close: () => {
        ending = true;
        return new Promise<void>((resolve) => (ended = resolve));
      },
    };
    let launches = 0;
    const session = new BrowserSession({
      launcher: {
        ...first.launcher,
        launch: async () => (++launches === 1 ? lostTarget : second.target),
      },
    });
    await session.open();

    first.lose();
    await vi.waitFor(() => expect(ending).toBe(true));
    await session.open("https://example.com/");
    ended();
    // Everything the end of the lost browser set off has run.
    await new Promise((resolve) => setImmediate(resolve));

    expect(session.state()).toMatchObject({
      status: "open",
      url: "https://example.com/",
    });
    expect(session.automation()).toBe(second.target.automation());
  });

  it("leaves the browser open now when an earlier one says late that it was lost", async () => {
    const first = fakeBrowser();
    const second = fakeBrowser();
    let launches = 0;
    const session = new BrowserSession({
      launcher: {
        ...first.launcher,
        launch: async () => (++launches === 1 ? first.target : second.target),
      },
    });
    await session.open();
    await session.close();
    await session.open("https://example.com/");

    first.lose();
    await new Promise((resolve) => setImmediate(resolve));

    expect(session.state()).toMatchObject({
      status: "open",
      url: "https://example.com/",
    });
    expect(second.closed()).toBe(false);
  });

  it("ends what is left of a browser whose page went away on its own", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open();

    fake.lose();

    await vi.waitFor(() => expect(fake.closed()).toBe(true));
  });

  it("reports a browser lost while it was being opened, and ends what is left of it", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({
      launcher: {
        ...fake.launcher,
        launch: async () => ({
          ...fake.target,
          // Lost before its first frame.
          startFrames: async (listener) => {
            await fake.target.startFrames(listener);
            fake.lose();
          },
        }),
      },
    });

    await session.open();

    await vi.waitFor(() => expect(fake.closed()).toBe(true));
    expect(session.state()).toMatchObject({
      status: "failed",
      reason: "The browser closed unexpectedly.",
    });
  });

  it("says the browser is lost before it closes the preview, and ends the browser when the preview cannot close", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({
      launcher: fake.launcher,
      workspaceRoot: () => "C:/workspace",
    });
    await session.open();
    let seen: string | undefined;
    vi.spyOn(session.preview!, "close").mockImplementation(async () => {
      seen = session.state().status;
      throw new Error("The preview server would not stop.");
    });

    fake.lose();

    await vi.waitFor(() => expect(fake.closed()).toBe(true));
    expect(seen).toBe("failed");
  });

  it("refuses to act on a browser that is not open", async () => {
    const session = new BrowserSession({ launcher: fakeBrowser().launcher });
    await expect(session.pointer(pressAt(1, 1))).rejects.toThrow(
      "The browser is not open.",
    );
    await expect(session.copy()).rejects.toThrow("The browser is not open.");
    await expect(session.navigate("https://example.com/")).rejects.toThrow(
      "The browser is not open.",
    );
  });

  it("passes a person's pointer, typing and wheel to the page", async () => {
    const fake = fakeBrowser();
    const pointer = vi.spyOn(fake.target, "pointer");
    const typeText = vi.spyOn(fake.target, "typeText");
    const pressKey = vi.spyOn(fake.target, "pressKey");
    const scroll = vi.spyOn(fake.target, "scroll");
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open();
    const drag = [
      pressAt(12, 34),
      { action: "move", x: 40, y: 34, button: "left", clicks: 0, keys: [] },
      {
        action: "release",
        x: 40,
        y: 34,
        button: "left",
        clicks: 1,
        keys: ["Shift"],
      },
    ] as const;

    for (const step of drag) await session.pointer(step);
    await session.typeText("hej");
    await session.pressKey("Enter");
    await session.scroll(5, 6, -40, 120);

    expect(pointer.mock.calls.map(([step]) => step)).toEqual(drag);
    expect(typeText).toHaveBeenCalledWith("hej");
    expect(pressKey).toHaveBeenCalledWith("Enter");
    expect(scroll).toHaveBeenCalledWith(5, 6, -40, 120);
  });

  it("passes a person's input to the page in the order given, each after the one before has landed", async () => {
    const fake = fakeBrowser();
    const landed: string[] = [];
    let letPressLand: (() => void) | undefined;
    fake.target.pointer = async (step) => {
      if (step.action === "press")
        await new Promise<void>((land) => (letPressLand = land));
      landed.push(step.action);
    };
    fake.target.typeText = async (text) => {
      landed.push(`type ${text}`);
    };
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open();

    // Sent at once, as a panel sends them; the press is slow to land.
    const sent = [
      session.pointer(pressAt(1, 1)),
      session.pointer({ ...pressAt(1, 1), action: "release" }),
      session.typeText("a"),
    ];
    await vi.waitFor(() => expect(letPressLand).toBeDefined());
    await new Promise((settle) => setTimeout(settle, 10));
    expect(landed).toEqual([]);
    letPressLand?.();
    await Promise.all(sent);

    expect(landed).toEqual(["press", "release", "type a"]);
  });

  it("pictures the page after a press, a release, a key and the wheel, but not after the pointer moves", async () => {
    const fake = fakeBrowser();
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open("https://example.com/");
    const before = fake.captured();

    await session.pointer({
      action: "move",
      x: 3,
      y: 4,
      clicks: 0,
      keys: [],
    });
    expect(fake.captured()).toBe(before);

    await session.pointer(pressAt(3, 4));
    await session.pointer({ ...pressAt(3, 4), action: "release" });
    await session.pressKey("Enter");
    await session.scroll(3, 4, 0, 100);
    expect(fake.captured()).toBe(before + 4);
  });

  it("answers the page's selection for the person's clipboard, and tells the page of the copy or cut after reading it", async () => {
    const fake = fakeBrowser();
    let selected = "12 Rue de la Paix";
    const pressed: string[] = [];
    fake.target.selectedText = async () => selected;
    fake.target.pressKey = async (key) => {
      pressed.push(key);
      // What a page does on Ctrl+X: the selection goes from the field.
      if (key === "Control+x") selected = "";
    };
    const session = new BrowserSession({ launcher: fake.launcher });
    await session.open();

    expect(await session.copy()).toBe("12 Rue de la Paix");
    expect(await session.cut()).toBe("12 Rue de la Paix");
    expect(await session.copy()).toBe("");

    expect(pressed).toEqual(["Control+c", "Control+x", "Control+c"]);
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
