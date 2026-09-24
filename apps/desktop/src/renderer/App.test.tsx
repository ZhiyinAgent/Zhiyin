import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppEvent, CoreApi, WorkspaceSnapshot } from "@zhiyin/contract";
import { App } from "./App.js";

/** A core that answers the handshake the way the real one does. */
const emptySnapshot: WorkspaceSnapshot = {
  runtime: { tasks: "available", capabilities: "unavailable" },
  tasks: [],
  selectedTaskId: null,
  plugins: [],
  mcpServers: [],
  usage: { status: "unavailable", reason: "No requests yet." },
};

function fakeCore(version: string): CoreApi & {
  sendMessage: ReturnType<typeof vi.fn<CoreApi["sendMessage"]>>;
} {
  const handlers: ((event: AppEvent) => void)[] = [];

  const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});

  return {
    frontendReady: async () => {
      handlers.forEach((handler) => {
        handler({ kind: "coreReady", data: { version } });
        handler({ kind: "workspaceSnapshot", data: emptySnapshot });
      });
    },
    createTask: async () => "core-task-1",
    selectTask: async () => {},
    renameTask: async () => {},
    deleteTask: async () => {},
    sendMessage,
    keepPaste: async () => ({ status: "refused", reason: "Not kept here." }),
    setContextBudget: async () => {},
    setDefaultContextBudget: async () => {},
    condenseNow: async () => {},
    openAttachment: async () => {},
    previewRewind: async () => {
      throw new Error("No rewind preview configured for this test.");
    },
    commitRewind: async () => ({ files: [] }),
    interruptTask: async () => {},
    resolveApproval: async () => {},
    resolveUserInput: async () => {},
    setComponentEnabled: async () => {},
    componentContent: async () => undefined,
    overrideComponent: async () => {},
    resetComponent: async () => {},
    installToolchain: async () => {},
    setPluginEnabled: async () => {},
    installPlugin: async () => ({ status: "cancelled" }),
    updatePlugin: async () => ({ status: "cancelled" }),
    rollbackPlugin: async () => {},
    removePlugin: async () => {},
    createPlugin: async () => {},
    savePluginContents: async () => {},
    editablePluginContents: async () => undefined,
    setMcpServerToolEnabled: async () => {},
    testMcpConnection: async () => ({ ok: false, reason: "Not configured." }),
    saveMcpServerToken: async () => {},
    clearMcpServerToken: async () => {},
    refreshConnections: async () => {},
    shellAvailability: async () => ({ available: true }),
    recheckShell: async () => ({ available: true }),
    openExternalUrl: async () => {},
    driveBrowser: async () => {},
    saveProviderApiKey: async () => ({ status: "accepted" as const }),
    clearProviderApiKey: async () => {},
    listModels: async () => ({ status: "ready" as const, models: [] }),
    listModelProviders: async () => ({
      status: "unavailable" as const,
      reason: "not in this test",
    }),
    selectModel: async () => {},
    previewArtifact: async () => ({
      status: "missing" as const,
      path: "",
      reason: "Not available in this test.",
    }),
    exportArtifact: async () => ({ status: "cancelled" as const }),
    exportView: async () => ({ status: "cancelled" as const }),
    readEvidence: async () => ({
      corrections: {
        retainedEntries: 0,
        shownEntries: 0,
        maximumEntries: 5000,
        entries: [],
      },
      recovery: {
        usedBytes: 0,
        retainedFiles: 0,
        excludedFiles: 0,
        limits: {
          totalBytes: 0,
          fileBytes: 0,
          versionsPerPath: 0,
          maximumAgeDays: 0,
        },
      },
      policy: {
        correctionRedaction: "",
        taskDeletion: "",
        privateStorage: "",
      },
    }),
    clearEvidence: async () => fakeCore(version).readEvidence(),
    answerViewCheck: async () => {},
    onViewCheck: () => () => {},
    onAppEvent: (handler) => {
      handlers.push(handler);
      return () => {
        handlers.splice(handlers.indexOf(handler), 1);
      };
    },
  };
}

describe("App", () => {
  it("offers the browser workspace from core events and updates its live picture without a context shelf", async () => {
    const core = fakeCore("0.1.0");
    const original = core.onAppEvent;
    let receive!: (event: AppEvent) => void;
    core.onAppEvent = (handler) => {
      receive = handler;
      return original(handler);
    };
    render(<App core={core} />);
    await screen.findByRole("heading", { name: "What should we work on?" });
    act(() => {
      receive({
        kind: "taskChanged",
        data: {
          id: "browser-task",
          title: "Browser task",
          updatedLabel: "Now",
          messages: [],
          phase: { kind: "draft" },
        },
      });
      receive({
        kind: "taskSelectionChanged",
        data: { taskId: "browser-task" },
      });
    });
    act(() =>
      receive({
        kind: "browserChanged",
        data: {
          taskId: "browser-task",
          browser: {
            status: "opening",
            loading: true,
            url: "",
            title: "",
          },
        },
      }),
    );
    // The browser shows itself when it opens: nobody has to find the tab to
    // learn there is one.
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("Zhiyin's browser")).toBeVisible();
    expect(screen.getByText("Loading…")).toBeVisible();
    for (const data of ["first-frame", "second-frame"]) {
      act(() =>
        receive({
          kind: "browserChanged",
          data: {
            taskId: "browser-task",
            browser: {
              status: "open",
              loading: false,
              url: "http://localhost/",
              title: "Preview",
              frame: { data, width: 1280, height: 800 },
            },
          },
        }),
      );
      expect(
        screen.getByAltText("Preview — the page Zhiyin is working on"),
      ).toHaveAttribute("src", `data:image/jpeg;base64,${data}`);
    }
    act(() =>
      receive({
        kind: "browserChanged",
        data: {
          taskId: "browser-task",
          browser: {
            status: "failed",
            loading: false,
            url: "",
            title: "",
            reason: "Browser disconnected",
          },
        },
      }),
    );
    expect(screen.getByText("Browser disconnected")).toBeVisible();
    act(() =>
      receive({
        kind: "browserChanged",
        data: {
          taskId: "browser-task",
          browser: { status: "closed", loading: false, url: "", title: "" },
        },
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Zhiyin's browser"),
      ).not.toBeInTheDocument(),
    );
  });

  it("removes another conversation's browser tab and notice after switching conversations", async () => {
    const core = fakeCore("0.1.0");
    const original = core.onAppEvent;
    let receive!: (event: AppEvent) => void;
    core.onAppEvent = (handler) => {
      receive = handler;
      return original(handler);
    };
    render(<App core={core} />);
    await screen.findByRole("heading", { name: "What should we work on?" });
    const task = (id: string, title: string) => ({
      id,
      title,
      updatedLabel: "Now",
      messages: [],
      phase: { kind: "draft" as const },
    });
    act(() => {
      receive({ kind: "taskChanged", data: task("first", "First") });
      receive({ kind: "taskChanged", data: task("second", "Second") });
      receive({
        kind: "taskSelectionChanged",
        data: { taskId: "first" },
      });
      receive({
        kind: "browserChanged",
        data: {
          taskId: "first",
          browser: {
            status: "open",
            loading: false,
            url: "https://first.example/",
            title: "First browser",
          },
        },
      });
    });
    expect(screen.getByRole("tab", { name: "Workspace" })).toBeVisible();

    act(() => {
      receive({
        kind: "taskSelectionChanged",
        data: { taskId: "second" },
      });
      receive({
        kind: "browserChanged",
        data: {
          taskId: "first",
          browser: {
            status: "open",
            loading: false,
            url: "https://first.example/updated",
            title: "First browser",
          },
        },
      });
    });

    expect(screen.queryByRole("tab", { name: "Workspace" })).toBeNull();
    expect(screen.queryByText(/opened a browser/i)).toBeNull();
  });
  it("answers core view checks from the renderer that owns drawing", async () => {
    const core = fakeCore("0.1.0");
    const answer = vi.fn<CoreApi["answerViewCheck"]>(async () => {});
    let check: Parameters<CoreApi["onViewCheck"]>[0] | undefined;
    core.answerViewCheck = answer;
    core.onViewCheck = (handler) => {
      check = handler;
      return () => {
        check = undefined;
      };
    };
    render(<App core={core} />);
    await screen.findByRole("heading", { name: "What should we work on?" });

    check?.({
      id: "check-1",
      kind: "histogram",
      source: JSON.stringify({
        kind: "histogram",
        title: "Latency",
        values: [1, 2, 3],
      }),
    });

    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith("check-1", { ok: true }),
    );
  });

  it("recovers when the first handshake fails", async () => {
    const core = fakeCore("0.1.0");
    const ready = core.frontendReady;
    let attempts = 0;
    core.frontendReady = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("not ready");
      await ready();
    };
    render(<App core={core} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "What should we work on?" }),
    ).toBeVisible();
  });
  it("says the window restarted after a problem, and that the work is intact, until dismissed", async () => {
    render(<App core={fakeCore("0.1.0")} restarted />);

    const title = await screen.findByText(
      "The window restarted after a problem.",
    );
    const notice = title.closest('[role="status"]');
    // Said politely: nothing went wrong that the person has to act on.
    expect(notice).not.toBeNull();
    expect(notice).toHaveTextContent("Your work is intact.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(
      screen.queryByText("The window restarted after a problem."),
    ).toBeNull();
  });

  it("says nothing about a restart on an ordinary start", async () => {
    render(<App core={fakeCore("0.1.0")} />);
    await screen.findByRole("heading", { name: "What should we work on?" });

    expect(screen.queryByText(/The window restarted/)).toBeNull();
  });

  it("replaces the loading shell with the production workspace after the handshake", async () => {
    render(<App core={fakeCore("0.1.0")} />);
    expect(
      await screen.findByRole("heading", { name: "What should we work on?" }),
    ).toBeVisible();
    expect(screen.queryByText("Core version 0.1.0")).toBeNull();
    expect(screen.getByLabelText("Message Zhiyin")).toBeEnabled();
  });

  it("sends the first message through the core-owned task command", async () => {
    const core = fakeCore("0.1.0");
    render(<App core={core} />);

    const composer = await screen.findByLabelText("Message Zhiyin");
    fireEvent.change(composer, { target: { value: "Introduce yourself" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(core.sendMessage).toHaveBeenCalledWith(
        "core-task-1",
        "Introduce yourself",
        undefined,
      ),
    );
  });
});
