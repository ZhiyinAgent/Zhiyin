import { describe, expect, it } from "vitest";
import type {
  AppEvent,
  BrowserFrameState,
  BrowserPanelState,
} from "@zhiyin/contract";
import { stubDependencies, loopFrom } from "./support.js";

describe("browser feed", () => {
  it("publishes automation-opened browser state and frames without a manual open", async () => {
    const events: AppEvent[] = [];
    const states = new Set<(state: BrowserPanelState) => void>();
    const frames = new Set<(frame: BrowserFrameState) => void>();
    let state: BrowserPanelState = {
      status: "closed",
      url: "",
      title: "",
      loading: false,
    };
    const deps = stubDependencies((event) => events.push(event));
    const browser = {
      ...deps.browsers.browser("fixture"),
      state: () => state,
      onState: (listener: (next: BrowserPanelState) => void) => {
        states.add(listener);
        return () => {
          states.delete(listener);
        };
      },
      onFrame: (listener: (frame: BrowserFrameState) => void) => {
        frames.add(listener);
        return () => {
          frames.delete(listener);
        };
      },
    };
    deps.browsers = {
      browser: () => browser,
      close: async () => browser.close(),
      forget: async () => browser.close(),
      closeAll: async () => browser.close(),
    };
    const loop = loopFrom(deps);
    await loop.initialize();
    await loop.initialize();
    await loop.createTask();
    await loop.driveBrowser({ kind: "open" });
    state = { status: "opening", url: "", title: "", loading: true };
    states.forEach((listener) => listener(state));
    expect(loop.snapshot().browser?.status).toBe("opening");
    state = {
      status: "open",
      url: "https://example.test",
      title: "Example",
      loading: false,
    };
    states.forEach((listener) => listener(state));
    const frame = { data: "jpeg", width: 1280, height: 800 };
    events.length = 0;
    frames.forEach((listener) => listener(frame));
    expect(
      events.filter((event) => event.kind === "browserChanged"),
    ).toHaveLength(1);
    expect(loop.snapshot().browser).toEqual({ ...state, frame });
    state = {
      status: "failed",
      url: "",
      title: "",
      loading: false,
      reason: "Browser closed unexpectedly",
    };
    states.forEach((listener) => listener(state));
    expect(loop.snapshot().browser).toEqual(state);
  });

  it("keeps browser sessions and their visible state with their conversations", async () => {
    const events: AppEvent[] = [];
    const opened: string[] = [];
    const sessions = new Map<string, ReturnType<typeof makeBrowser>>();
    let taskNumber = 0;
    const deps = stubDependencies((event) => events.push(event));
    deps.newTaskId = () => `task-${++taskNumber}`;
    deps.browsers = {
      browser: (taskId) => {
        let browser = sessions.get(taskId);
        if (!browser) {
          browser = makeBrowser(taskId, opened);
          sessions.set(taskId, browser);
        }
        return browser;
      },
      close: async (taskId) => sessions.get(taskId)?.close(),
      forget: async (taskId) => {
        await sessions.get(taskId)?.close();
        sessions.delete(taskId);
      },
      closeAll: async () => {
        await Promise.all(
          [...sessions.values()].map((browser) => browser.close()),
        );
      },
    };
    const loop = loopFrom(deps);
    await loop.initialize();
    const first = await loop.createTask();
    await loop.driveBrowser({ kind: "open" });
    sessions.get(first)?.publish({
      status: "open",
      url: "https://first.example/",
      title: "First",
      loading: false,
    });

    const second = await loop.createTask();

    expect(loop.snapshot().browser?.status).toBe("closed");
    await loop.driveBrowser({ kind: "open" });
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

function makeBrowser(taskId: string, opened: string[]) {
  let state: BrowserPanelState = {
    status: "closed",
    url: "",
    title: "",
    loading: false,
  };
  const listeners = new Set<(state: BrowserPanelState) => void>();
  return {
    refresh: async () => {},
    availability: async () => ({
      available: true as const,
      browserName: "Test",
    }),
    state: () => state,
    lastFrame: () => undefined,
    automation: () => undefined,
    onState: (listener: (next: BrowserPanelState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onFrame: () => () => {},
    markAgentAction: () => {},
    onAgentAction: () => () => {},
    open: async () => {
      opened.push(taskId);
    },
    navigate: async () => {},
    back: async () => {},
    forward: async () => {},
    reload: async () => {},
    click: async () => {},
    typeText: async () => {},
    pressKey: async () => {},
    scroll: async () => {},
    close: async () => {},
    publish(next: BrowserPanelState) {
      state = next;
      listeners.forEach((listener) => listener(next));
    },
  };
}
