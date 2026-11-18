import { describe, expect, it } from "vitest";
import type {
  AppEvent,
  BrowserFrameState,
  BrowserPanelState,
} from "@zhiyin/contract";
import { fakeBrowser, fakeBrowsers } from "@zhiyin/interactive-browser/testing";
import { stubDependencies, loopFrom } from "./support.js";

const closed: BrowserPanelState = {
  status: "closed",
  url: "",
  title: "",
  loading: false,
};

/**
 * A browser whose page the test moves: `publish` sets what it shows and tells
 * whoever listens, as a page that changed does. Opening it notes its
 * conversation in `opened`.
 */
function publishing(conversationId: string, opened: string[] = []) {
  let state = closed;
  const states = new Set<(state: BrowserPanelState) => void>();
  const frames = new Set<(frame: BrowserFrameState) => void>();
  const listen =
    <T>(listeners: Set<(value: T) => void>) =>
    (listener: (value: T) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
  return {
    browser: fakeBrowser({
      availability: async () => ({ available: true, browserName: "Test" }),
      state: () => state,
      onState: listen(states),
      onFrame: listen(frames),
      open: async () => {
        opened.push(conversationId);
      },
    }),
    publish(next: BrowserPanelState) {
      state = next;
      states.forEach((listener) => listener(next));
    },
    frame(frame: BrowserFrameState) {
      frames.forEach((listener) => listener(frame));
    },
  };
}

describe("browser feed", () => {
  it("publishes automation-opened browser state and frames without a manual open", async () => {
    const events: AppEvent[] = [];
    const page = publishing("fixture");
    const deps = {
      ...stubDependencies((event) => events.push(event)),
      browsers: fakeBrowsers(() => page.browser),
    };
    const loop = loopFrom(deps);
    await loop.initialize();
    await loop.initialize();
    await loop.createTask();
    await loop.surfaces.driveBrowser({ kind: "open" });
    page.publish({ status: "opening", url: "", title: "", loading: true });
    expect(loop.snapshot().browser?.status).toBe("opening");
    const open: BrowserPanelState = {
      status: "open",
      url: "https://example.test",
      title: "Example",
      loading: false,
    };
    page.publish(open);
    const frame = { data: "jpeg", width: 1280, height: 800 };
    events.length = 0;
    page.frame(frame);
    expect(
      events.filter((event) => event.kind === "browserChanged"),
    ).toHaveLength(1);
    expect(loop.snapshot().browser).toEqual({ ...open, frame });
    const failed: BrowserPanelState = {
      status: "failed",
      url: "",
      title: "",
      loading: false,
      reason: "Browser closed unexpectedly",
    };
    page.publish(failed);
    expect(loop.snapshot().browser).toEqual(failed);
  });

  it("keeps browser sessions and their visible state with their conversations", async () => {
    const events: AppEvent[] = [];
    const opened: string[] = [];
    const pages = new Map<string, ReturnType<typeof publishing>>();
    let taskNumber = 0;
    const deps = {
      ...stubDependencies((event) => events.push(event)),
      browsers: fakeBrowsers((taskId) => {
        const page = publishing(taskId, opened);
        pages.set(taskId, page);
        return page.browser;
      }),
    };
    deps.newTaskId = () => `task-${++taskNumber}`;
    const loop = loopFrom(deps);
    await loop.initialize();
    const first = await loop.createTask();
    await loop.surfaces.driveBrowser({ kind: "open" });
    pages.get(first)?.publish({
      status: "open",
      url: "https://first.example/",
      title: "First",
      loading: false,
    });

    const second = await loop.createTask();

    expect(loop.snapshot().browser?.status).toBe("closed");
    await loop.surfaces.driveBrowser({ kind: "open" });
    expect(opened).toEqual([first, second]);

    await loop.selectTask(first);
    expect(loop.snapshot().browser?.title).toBe("First");
    expect(events.findLast((event) => event.kind === "browserChanged")).toEqual(
      {
        kind: "browserChanged",
        data: {
          taskId: first,
          browser: {
            status: "open",
            url: "https://first.example/",
            title: "First",
            loading: false,
          },
        },
      },
    );
  });
});

describe("a person's hands on the open conversation's page", () => {
  it("passes each pointer step, the wheel both ways, and answers what a copy or a cut took", async () => {
    const reached: unknown[] = [];
    const deps = {
      ...stubDependencies(() => {}),
      browsers: fakeBrowsers(() =>
        fakeBrowser({
          pointer: async (step) => void reached.push(step),
          scroll: async (...wheel) => void reached.push(wheel),
          copy: async () => "12 Rue de la Paix",
          cut: async () => "Paris",
        }),
      ),
    };
    const loop = loopFrom(deps);
    await loop.initialize();
    await loop.createTask();
    const release = {
      action: "release",
      x: 3,
      y: 4,
      button: "right",
      clicks: 2,
      keys: ["Shift"],
    } as const;

    await loop.surfaces.driveBrowser({ kind: "pointer", ...release });
    await loop.surfaces.driveBrowser({
      kind: "scroll",
      x: 3,
      y: 4,
      deltaX: 40,
      deltaY: -120,
    });

    expect(reached).toEqual([
      expect.objectContaining(release),
      [3, 4, 40, -120],
    ]);
    expect(await loop.surfaces.driveBrowser({ kind: "copy" })).toBe(
      "12 Rue de la Paix",
    );
    expect(await loop.surfaces.driveBrowser({ kind: "cut" })).toBe("Paris");
    expect(
      await loop.surfaces.driveBrowser({ kind: "key", key: "Enter" }),
    ).toBeUndefined();
  });
});

describe("the panel watching a conversation's page", () => {
  /** Browsers that note each conversation's panel size, or none. */
  function watching(watched: [string, unknown][]) {
    return fakeBrowsers((taskId) =>
      fakeBrowser({
        watch: async (view) => {
          watched.push([taskId, view]);
        },
      }),
    );
  }

  it("tells that conversation's browser the panel's size, and when no panel shows it", async () => {
    const watched: [string, unknown][] = [];
    const deps = {
      ...stubDependencies(() => {}),
      browsers: watching(watched),
    };
    const loop = loopFrom(deps);
    await loop.initialize();
    const taskId = await loop.createTask();

    await loop.surfaces.watchBrowser(taskId, { width: 900, height: 560 });
    await loop.surfaces.watchBrowser(taskId, null);
    await loop.surfaces.watchBrowser("gone", { width: 900, height: 560 });

    expect(watched).toEqual([
      [taskId, { width: 900, height: 560 }],
      [taskId, undefined],
    ]);
  });

  it("stops every stream when a window attaches, since a new window watches nothing yet", async () => {
    const watched: [string, unknown][] = [];
    const deps = {
      ...stubDependencies(() => {}),
      browsers: watching(watched),
    };
    let taskNumber = 0;
    deps.newTaskId = () => `task-${++taskNumber}`;
    const loop = loopFrom(deps);
    await loop.initialize();
    const first = await loop.createTask();
    const second = await loop.createTask();
    await loop.surfaces.watchBrowser(first, { width: 900, height: 560 });
    await loop.surfaces.watchBrowser(second, { width: 600, height: 400 });
    await loop.surfaces.watchBrowser(second, null);
    watched.length = 0;

    // The window reloaded without saying it stopped watching.
    loop.attachWindow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(watched).toEqual([[first, undefined]]);
  });
});
