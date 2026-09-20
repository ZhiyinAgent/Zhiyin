import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CoreApi } from "@zhiyin/contract";
import { createWorkspaceState, type WorkspaceTask } from "./workspaceState.js";
import { WorkspaceShell } from "./WorkspaceShell.js";

/** Every command the shell may reach for, doing nothing. */
const stubCommands: CoreApi = {
  frontendReady: async () => {},
  createTask: async () => "task-1",
  selectTask: async () => {},
  renameTask: async () => {},
  deleteTask: async () => {},
  sendMessage: async () => {},
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
    status: "missing",
    path: "",
    reason: "none",
  }),
  exportArtifact: async () => ({ status: "cancelled" }),
  exportView: async () => ({ status: "cancelled" }),
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
  clearEvidence: async () => stubCommands.readEvidence(),
  onAppEvent: () => () => {},
  onViewCheck: () => () => {},
  answerViewCheck: async () => {},
};

describe("WorkspaceShell", () => {
  it("keeps the conversation and final answer beside the browser with the selector in the header", () => {
    const task: WorkspaceTask = {
      id: "read",
      title: "Read a page",
      updatedLabel: "Now",
      messages: [{ id: "u", role: "user", text: "Read this page" }],
      phase: { kind: "working", steps: [] },
    };
    const state = createWorkspaceState({
      connection: "ready",
      tasks: [task],
      selectedTaskId: task.id,
      browser: {
        status: "open",
        url: "https://example.com",
        title: "Preview",
        loading: false,
        frame: { data: "frame", width: 1280, height: 800 },
      },
    });
    const { rerender } = render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );
    const selector = within(
      screen.getByRole("banner", { name: "Task header" }),
    ).getByRole("tab", { name: "Workspace" });
    fireEvent.click(selector);
    expect(
      screen.getByRole("log", { name: "Task conversation" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: /Preview — the page/ }),
    ).toBeVisible();
    rerender(
      <WorkspaceShell
        state={{
          ...state,
          tasks: [
            {
              ...task,
              messages: [
                ...task.messages,
                {
                  id: "a",
                  role: "assistant",
                  text: "The comparison is ready.",
                },
              ],
              phase: {
                kind: "completed",
                outcome: { title: "Ready", summary: "Done" },
              },
            },
          ],
        }}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );
    expect(screen.getByText("The comparison is ready.")).toBeVisible();
    expect(selector).toHaveAttribute("aria-selected", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "Return to conversation" }),
    );
    expect(screen.getByRole("tab", { name: "Conversation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("log", { name: "Task conversation" }),
    ).toBeVisible();
  });

  it("shows task activity and lets the user stop work from the browser workspace", async () => {
    const interruptTask = vi.fn().mockResolvedValue(undefined);
    const task: WorkspaceTask = {
      id: "work",
      title: "Research",
      updatedLabel: "Now",
      messages: [{ id: "u", role: "user", text: "Research this page" }],
      phase: { kind: "working", steps: [] },
    };
    const state = createWorkspaceState({
      connection: "ready",
      tasks: [task],
      selectedTaskId: task.id,
      browser: {
        status: "open",
        title: "Research",
        url: "https://example.com",
        loading: false,
      },
    });
    const { rerender } = render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={{ ...stubCommands, interruptTask }}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Workspace" }));
    expect(screen.getByText("Working")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
    await waitFor(() => expect(interruptTask).toHaveBeenCalledWith("work"));
    rerender(
      <WorkspaceShell
        state={{
          ...state,
          tasks: [{ ...task, phase: { kind: "interrupted" } }],
        }}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );
    expect(screen.getByText("Task stopped")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
  });

  it("shows the workspace itself the first time Zhiyin opens a browser, and stays where it is put after that", () => {
    const closed = createWorkspaceState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
    });
    const open = {
      ...closed,
      browser: {
        status: "open" as const,
        url: "https://example.com",
        title: "Preview",
        loading: false,
        frame: { data: "first", width: 1280, height: 800 },
      },
    };
    const { rerender } = render(
      <WorkspaceShell
        state={closed}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );
    expect(screen.queryByRole("tab", { name: "Workspace" })).toBeNull();

    rerender(
      <WorkspaceShell
        state={open}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    // Nobody has to discover the tab to find out a browser opened.
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));
    rerender(
      <WorkspaceShell
        state={{
          ...open,
          browser: {
            ...open.browser,
            frame: { data: "next", width: 1280, height: 800 },
          },
        }}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    // The choice is theirs from then on: the browser working does not grab it.
    expect(screen.getByRole("tab", { name: "Conversation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("says in the conversation that a browser is open, and opens it from there", () => {
    const state = createWorkspaceState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      browser: {
        status: "open",
        url: "https://example.com",
        title: "Preview",
        loading: false,
        frame: { data: "first", width: 1280, height: 800 },
      },
    });
    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));

    const notice = screen.getByText(/opened a browser/);
    expect(notice).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show workspace" }));

    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByText(/opened a browser/)).toBeNull();
  });

  it("marks the workspace tab while the browser is busy and the conversation is showing", () => {
    const state = createWorkspaceState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      browser: {
        status: "open",
        url: "https://example.com",
        title: "Preview",
        loading: true,
        frame: { data: "first", width: 1280, height: 800 },
      },
    });
    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    // While it is being watched there is nothing to point at.
    expect(screen.getByRole("tab", { name: "Workspace" })).not.toHaveAttribute(
      "data-live",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));

    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute(
      "data-live",
      "true",
    );
  });

  it("switches between conversation and live browser without losing the draft or closing the session", () => {
    const commands = { ...stubCommands, driveBrowser: vi.fn() };
    const state = createWorkspaceState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      browser: {
        status: "open",
        url: "https://example.com",
        title: "Preview",
        loading: false,
        frame: { data: "first", width: 1280, height: 800 },
      },
    });
    const { rerender } = render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={commands}
      />,
    );
    const composer = screen.getByRole("textbox", { name: /message/i });
    fireEvent.change(composer, { target: { value: "Keep my draft" } });
    fireEvent.click(screen.getByRole("tab", { name: "Workspace" }));
    expect(
      screen.getByRole("log", { name: "Task conversation" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: /Preview — the page/ }),
    ).toHaveAttribute("src", "data:image/jpeg;base64,first");
    fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));
    expect(composer).toHaveValue("Keep my draft");
    rerender(
      <WorkspaceShell
        state={{
          ...state,
          browser: {
            ...state.browser,
            frame: { data: "next", width: 1280, height: 800 },
          },
        }}
        dispatch={() => undefined}
        commands={commands}
      />,
    );
    const conversationTab = screen.getByRole("tab", { name: "Conversation" });
    fireEvent.keyDown(conversationTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveFocus();
    expect(
      screen.getByRole("img", { name: /Preview — the page/ }),
    ).toHaveAttribute("src", "data:image/jpeg;base64,next");
    expect(commands.driveBrowser).not.toHaveBeenCalled();
    rerender(
      <WorkspaceShell
        state={{
          ...state,
          browser: { status: "closed", url: "", title: "", loading: false },
        }}
        dispatch={() => undefined}
        commands={commands}
      />,
    );
    expect(screen.queryByRole("tab", { name: "Workspace" })).toBeNull();
    expect(
      screen.getByRole("log", { name: "Task conversation" }),
    ).toBeVisible();
    expect(composer).toHaveValue("Keep my draft");
    rerender(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={commands}
      />,
    );
    expect(screen.getByRole("tab", { name: "Conversation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it.each(["Allow once", "Deny"])(
    "keeps one approval accessible in either workspace view: %s",
    async (decision) => {
      const resolveApproval = vi.fn().mockResolvedValue(undefined);
      const state = createWorkspaceState({
        connection: "ready",
        selectedTaskId: "preview-task",
        browser: {
          status: "open",
          url: "https://example.com",
          title: "Preview",
          loading: false,
        },
        tasks: [
          {
            id: "preview-task",
            title: "Preview",
            updatedLabel: "Now",
            messages: [],
            phase: {
              kind: "approval",
              steps: [],
              prompt: {
                id: "read-page",
                action: "Read page",
                reason: "Read the current page.",
                target: "Zhiyin’s browser",
                command: "browser_snapshot({})",
              },
            },
          },
        ],
      });
      render(
        <WorkspaceShell
          state={state}
          dispatch={() => undefined}
          commands={{ ...stubCommands, resolveApproval }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      fireEvent.click(screen.getByRole("tab", { name: "Workspace" }));
      expect(
        screen.getAllByRole("region", { name: "Permission request" }),
      ).toHaveLength(1);
      expect(screen.getByText("browser_snapshot({})")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: decision }));
      await waitFor(() =>
        expect(resolveApproval).toHaveBeenCalledWith(
          "preview-task",
          "read-page",
          decision === "Allow once" ? "allow" : "deny",
        ),
      );
    },
  );

  it("shows one live reasoning mark and passes the selected effort to the core", async () => {
    const task: WorkspaceTask = {
      id: "reasoning",
      title: "Research",
      updatedLabel: "Now",
      messages: [
        { id: "u", role: "user", text: "Research this" },
        {
          id: "r",
          role: "assistant",
          text: "",
          reasoning: { text: "Comparing sources.", status: "streaming" },
        },
      ],
      phase: { kind: "working", steps: [] },
    };
    const state = createWorkspaceState({
      connection: "ready",
      selectedTaskId: task.id,
      tasks: [task],
      runtime: { tasks: "available", capabilities: "available" },
      provider: {
        ...createWorkspaceState().provider,
        reasoning: {
          status: "available",
          required: true,
          defaultEnabled: true,
          defaultEffort: "max",
          efforts: ["max", "high", "low"],
        },
      },
    });
    const send = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <WorkspaceShell
        state={state}
        dispatch={() => {}}
        commands={{ ...stubCommands, sendMessage: send }}
      />,
    );
    expect(screen.getAllByLabelText("Zhiyin response")).toHaveLength(1);
    expect(screen.getByText("Comparing sources.")).toBeVisible();
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
    rerender(
      <WorkspaceShell
        state={{
          ...state,
          tasks: [
            {
              ...task,
              phase: { kind: "interrupted" },
              messages: [
                task.messages[0]!,
                {
                  ...task.messages[1]!,
                  reasoning: {
                    text: "Comparing sources.",
                    status: "interrupted",
                  },
                },
              ],
            },
          ],
        }}
        dispatch={() => {}}
        commands={{ ...stubCommands, sendMessage: send }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Reasoning settings"));
    fireEvent.change(screen.getByLabelText("Reasoning effort"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Continue" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(task.id, "Continue", {
        enabled: true,
        effort: "low",
      }),
    );
  });
  it("keeps retained history visible and restores the selected message to the composer after rewind", async () => {
    const commitRewind = vi.fn(async () => ({ files: [] }));
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          tasks: [
            {
              id: "task-1",
              title: "Draft a note",
              updatedLabel: "Now",
              messages: [
                {
                  id: "message-1",
                  role: "user",
                  text: "Draft a note",
                  sequence: 0,
                },
                {
                  id: "message-2",
                  role: "assistant",
                  text: "Here is a draft.",
                  sequence: 1,
                },
                {
                  id: "message-3",
                  role: "user",
                  text: "Make it shorter",
                  sequence: 2,
                },
                {
                  id: "message-4",
                  role: "assistant",
                  text: "Shortened.",
                  sequence: 3,
                },
              ],
              phase: {
                kind: "completed",
                outcome: { title: "Done", summary: "The note is ready." },
              },
            },
          ],
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          previewRewind: async () => ({
            id: "rewind-1",
            taskId: "task-1",
            messageId: "message-3",
            draft: "Make it shorter",
            discardedMessages: 2,
            discardedActions: [],
            files: [],
          }),
          commitRewind,
        }}
      />,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Rewind to this message" })[1]!,
    );
    await screen.findByRole("dialog", { name: "Rewind conversation" });
    fireEvent.click(
      screen.getByRole("button", { name: "Rewind conversation" }),
    );

    await waitFor(() =>
      expect(commitRewind).toHaveBeenCalledWith("task-1", "rewind-1", "keep"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Message Zhiyin" }),
      ).toHaveValue("Make it shorter"),
    );
    expect(screen.getByText("Here is a draft.")).toBeVisible();
  });

  it("places durable tool-result views in conversation order", () => {
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          tasks: [
            {
              id: "task-1",
              title: "Compare",
              updatedLabel: "Now",
              messages: [
                { id: "m1", role: "user", text: "Compare", sequence: 0 },
              ],
              views: [
                {
                  id: "view-1",
                  callId: "call-1",
                  kind: "bar-chart",
                  title: "Comparison",
                  source: JSON.stringify({
                    kind: "bar-chart",
                    title: "Comparison",
                    categories: [{ label: "A", value: 4 }],
                  }),
                  sequence: 1,
                },
              ],
              phase: {
                kind: "completed",
                outcome: { title: "Done", summary: "Compared." },
              },
            },
          ],
        })}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(screen.getByRole("img", { name: "Comparison" })).toBeVisible();
  });

  it("closes mobile navigation when the capability library opens", () => {
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
        })}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(
      screen.getByRole("button", { name: "Close navigation" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toBeVisible();
  });

  it("keeps the files a task produced in a panel of their own, addressed by task", async () => {
    const previewArtifact = vi.fn<CoreApi["previewArtifact"]>(async () => ({
      status: "ready" as const,
      path: "reports/brief.md",
      text: "The finished brief.",
      truncated: false,
    }));
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          tasks: [
            {
              id: "task-1",
              title: "Write the brief",
              updatedLabel: "Now",
              messages: [{ id: "m1", role: "user", text: "Write the brief" }],
              artifacts: [
                {
                  path: "reports/brief.md",
                  name: "brief.md",
                  change: "created",
                  bytes: 19,
                  updatedAt: "2026-09-05T10:00:00.000Z",
                },
              ],
              phase: {
                kind: "completed",
                outcome: { title: "Done", summary: "The brief is ready." },
              },
            },
          ],
        })}
        dispatch={() => undefined}
        commands={{
          createTask: async () => "task-1",
          selectTask: async () => {},
          renameTask: async () => {},
          deleteTask: async () => {},
          sendMessage: async () => {},
          interruptTask: async () => {},
          resolveApproval: async () => {},
          resolveUserInput: async () => {},
          setComponentEnabled: async () => {},
          componentContent: async () => undefined,
          overrideComponent: async () => {},
          resetComponent: async () => {},
          installToolchain: async () => {},
          setPluginEnabled: async () => {},
          installPlugin: async () => ({ status: "cancelled" as const }),
          updatePlugin: async () => ({ status: "cancelled" as const }),
          rollbackPlugin: async () => {},
          removePlugin: async () => {},
          createPlugin: async () => {},
          savePluginContents: async () => {},
          editablePluginContents: async () => undefined,
          setMcpServerToolEnabled: async () => {},
          testMcpConnection: async () => ({
            ok: false,
            reason: "Not configured.",
          }),
          saveMcpServerToken: async () => {},
          clearMcpServerToken: async () => {},
          refreshConnections: async () => {},
          shellAvailability: async () => ({ available: true }),
          recheckShell: async () => ({ available: true }),
          openExternalUrl: async () => {},
          driveBrowser: async () => {},
          saveProviderApiKey: async () => ({ status: "accepted" as const }),
          clearProviderApiKey: async () => {},
          listModels: async () => ({ status: "ready", models: [] }),
          listModelProviders: async () => ({
            status: "unavailable",
            reason: "not in this test",
          }),
          selectModel: async () => {},
          previewArtifact,
          exportArtifact: async () => ({ status: "cancelled" as const }),
        }}
      />,
    );

    // Out of the thread: reachable at any point in the conversation rather
    // than at the point it happened to be written.
    expect(
      screen.queryByRole("region", { name: "Files this task produced" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Files/ }));

    const produced = screen.getByRole("region", {
      name: "Files this task produced",
    });
    expect(within(produced).getByText("reports/brief.md")).toBeVisible();

    fireEvent.click(
      within(produced).getByRole("button", { name: /brief\.md/ }),
    );

    expect(previewArtifact).toHaveBeenCalledWith("task-1", "reports/brief.md");
    expect(await screen.findByText("The finished brief.")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("region", { name: "Files this task produced" }),
    ).toBeNull();
  });

  /**
   * Starting a new conversation and then choosing a folder for it used to
   * reopen whichever conversation had that folder. A snapshot carries which
   * conversation is open, and the core was never told this one had been left,
   * so the next snapshot to arrive put the old one back.
   */
  it("tells the core when a conversation is left for a new one", () => {
    const selectNothing = vi.fn(async () => {});
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          tasks: [
            {
              id: "task-1",
              title: "Earlier work",
              updatedLabel: "Now",
              messages: [{ id: "m1", role: "user", text: "Hello" }],
              phase: {
                kind: "completed",
                outcome: { title: "Done", summary: "Finished." },
              },
            },
          ],
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, selectNothing }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New task" }));

    expect(selectNothing).toHaveBeenCalled();
  });

  it("uses content-shaped placeholders while the workspace loads", () => {
    render(
      <WorkspaceShell
        state={createWorkspaceState({ connection: "loading" })}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Loading workspace" }),
    ).toBeVisible();
    expect(screen.queryByText(/connecting to the core/i)).toBeNull();
  });

  it("creates a new task and submits its first message", async () => {
    const createTask = vi.fn<CoreApi["createTask"]>(async () => "task-new");
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, createTask, sendMessage }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Review the recent changes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        "task-new",
        "Review the recent changes",
        undefined,
      ),
    );
  });

  it("keeps New task ephemeral until the first message is sent", async () => {
    const createTask = vi.fn<CoreApi["createTask"]>(async () => "task-new");
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
        })}
        dispatch={() => undefined}
        commands={{
          createTask,
          selectTask: async () => {},
          renameTask: async () => {},
          deleteTask: async () => {},
          sendMessage,
          interruptTask: async () => {},
          resolveApproval: async () => {},
          resolveUserInput: async () => {},
          setComponentEnabled: async () => {},
          componentContent: async () => undefined,
          overrideComponent: async () => {},
          resetComponent: async () => {},
          installToolchain: async () => {},
          setPluginEnabled: async () => {},
          installPlugin: async () => ({ status: "cancelled" as const }),
          updatePlugin: async () => ({ status: "cancelled" as const }),
          rollbackPlugin: async () => {},
          removePlugin: async () => {},
          createPlugin: async () => {},
          savePluginContents: async () => {},
          editablePluginContents: async () => undefined,
          setMcpServerToolEnabled: async () => {},
          testMcpConnection: async () => ({
            ok: false,
            reason: "Not configured.",
          }),
          saveMcpServerToken: async () => {},
          clearMcpServerToken: async () => {},
          refreshConnections: async () => {},
          shellAvailability: async () => ({ available: true }),
          recheckShell: async () => ({ available: true }),
          openExternalUrl: async () => {},
          driveBrowser: async () => {},
          saveProviderApiKey: async () => ({ status: "accepted" as const }),
          clearProviderApiKey: async () => {},
          listModels: async () => ({ status: "ready", models: [] }),
          listModelProviders: async () => ({
            status: "unavailable",
            reason: "not in this test",
          }),
          selectModel: async () => {},
          previewArtifact: async () => ({
            status: "missing" as const,
            path: "",
            reason: "Not available in this test.",
          }),
          exportArtifact: async () => ({ status: "cancelled" as const }),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(createTask).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Review the project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledWith(
      "task-new",
      "Review the project",
      undefined,
    );
  });

  it("keeps context concise and progress only in the work trace", () => {
    const state = createWorkspaceState({
      connection: "ready",
      selectedTaskId: "release",
      tasks: [
        {
          id: "release",
          title: "Prepare release notes",
          updatedLabel: "Now",
          messages: [
            { id: "user", role: "user", text: "Prepare release notes" },
          ],
          phase: {
            kind: "working",
            steps: [
              {
                id: "draft",
                label: "Draft release notes",
                status: "active",
              },
            ],
          },
          context: {
            kind: "workspace",
            project: "Zhiyin",
            files: [{ name: "release-notes.md", meta: "Edited" }],
            changes: "+12 −2",
          },
        },
      ],
    });

    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    const trace = screen.getByRole("region", { name: "Work trace" });
    const shelf = screen.getByRole("complementary", {
      name: "Session context",
    });
    expect(within(trace).getByText("Draft release notes")).toBeVisible();
    expect(within(shelf).queryByText("Draft release notes")).toBeNull();
    expect(within(shelf).getByText("release-notes.md")).toBeVisible();
  });

  it("renders one structured Markdown answer without repeating its completion summary", () => {
    const answer = [
      "## Project overview",
      "",
      "- React desktop application",
      "- Strict TypeScript workspace",
      "",
      "| Area | Tool |",
      "| --- | --- |",
      "| Tests | Vitest |",
    ].join("\n");
    const state = createWorkspaceState({
      connection: "ready",
      selectedTaskId: "complete",
      tasks: [
        {
          id: "complete",
          title: "Summarize the project",
          updatedLabel: "Now",
          messages: [
            { id: "user", role: "user", text: "Summarize the project" },
            { id: "assistant", role: "assistant", text: answer },
          ],
          actions: [
            {
              id: "read-package",
              action: "Read a workspace file",
              target: "package.json",
              status: "completed",
            },
          ],
          phase: {
            kind: "completed",
            outcome: { title: "Response complete", summary: answer },
          },
        },
      ],
    });

    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Project overview", level: 2 }),
    ).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Action history" })).getByText(
        "package.json",
      ),
    ).toBeVisible();
    expect(
      screen.getAllByRole("article", { name: "Zhiyin response" }),
    ).toHaveLength(1);
    expect(screen.queryByText("Response complete")).toBeNull();
  });

  /**
   * A turn opens the moment the model starts speaking, and the first thing it
   * sends is often a blank line. That produced an empty response bubble beside
   * the "Working" one — two marks in the margin for one turn, one of them with
   * nothing under it.
   */
  it("shows one mark while a turn is still finding its words, and one once it has", () => {
    const starting = (text: string) =>
      createWorkspaceState({
        connection: "ready",
        selectedTaskId: "starting",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [
          {
            id: "starting",
            title: "Summarise the directory",
            updatedLabel: "Now",
            messages: [
              { id: "m1", role: "user", text: "Summarise the directory" },
              { id: "m2", role: "assistant", text },
            ],
            phase: { kind: "working", steps: [] },
          },
        ],
      });

    const { rerender } = render(
      <WorkspaceShell
        state={starting("\n\n")}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      screen.getAllByRole("article", { name: "Zhiyin response" }),
    ).toHaveLength(1);
    expect(screen.getByText("Working")).toBeVisible();

    rerender(
      <WorkspaceShell
        state={starting("\n\nThere are four files.")}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    // Still one: the answer takes the place of the status rather than
    // appearing beside it.
    expect(
      screen.getAllByRole("article", { name: "Zhiyin response" }),
    ).toHaveLength(1);
    expect(screen.getByText("There are four files.")).toBeVisible();
    expect(screen.queryByText("Working")).toBeNull();
  });

  it("renders explanations and actions in chronological order", () => {
    const state = createWorkspaceState({
      connection: "ready",
      selectedTaskId: "ordered",
      tasks: [
        {
          id: "ordered",
          title: "Identify the project",
          updatedLabel: "Now",
          messages: [
            {
              id: "user",
              role: "user",
              text: "Identify the project",
              sequence: 0,
            },
            {
              id: "before",
              role: "assistant",
              text: "I’ll inspect the manifest.",
              sequence: 1,
            },
            {
              id: "after",
              role: "assistant",
              text: "The manifest identifies the project as Zhiyin.",
              sequence: 3,
            },
          ],
          actions: [
            {
              id: "read-package",
              action: "Read package.json",
              description: "Identify the current project from its manifest.",
              target: "package.json",
              status: "completed",
              sequence: 2,
            },
          ],
          phase: {
            kind: "completed",
            outcome: {
              title: "Response complete",
              summary: "The manifest identifies the project as Zhiyin.",
            },
          },
        },
      ],
    });

    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    const before = screen.getByText("I’ll inspect the manifest.");
    const action = screen.getByText("Read package.json");
    const after = screen.getByText(
      "The manifest identifies the project as Zhiyin.",
    );
    expect(
      before.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      action.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("follows streaming output only while the reader remains near the latest message", () => {
    const stateWith = (text: string) =>
      createWorkspaceState({
        connection: "ready",
        selectedTaskId: "streaming",
        tasks: [
          {
            id: "streaming",
            title: "Streaming response",
            updatedLabel: "Now",
            messages: [
              { id: "user", role: "user", text: "Explain the project" },
              { id: "assistant", role: "assistant", text },
            ],
            phase: { kind: "working", steps: [] },
          },
        ],
      });
    const { rerender } = render(
      <WorkspaceShell
        state={stateWith("First paragraph")}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );
    const conversation = screen.getByRole("log", {
      name: "Task conversation",
    });
    Object.defineProperties(conversation, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 200 },
    });

    conversation.scrollTop = 790;
    fireEvent.scroll(conversation);
    rerender(
      <WorkspaceShell
        state={stateWith("First paragraph\n\nSecond paragraph")}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );
    expect(conversation.scrollTop).toBe(1_000);

    conversation.scrollTop = 120;
    fireEvent.scroll(conversation);
    rerender(
      <WorkspaceShell
        state={stateWith(
          "First paragraph\n\nSecond paragraph\n\nThird paragraph",
        )}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );
    expect(conversation.scrollTop).toBe(120);
  });

  it("keeps the explanation in the turn and the decision beside the composer", () => {
    const state = createWorkspaceState({
      connection: "ready",
      selectedTaskId: "approval",
      tasks: [
        {
          id: "approval",
          title: "Read package.json",
          updatedLabel: "Now",
          messages: [
            { id: "user", role: "user", text: "Read package.json" },
            {
              id: "assistant",
              role: "assistant",
              text: "I’ll inspect the project file.",
            },
          ],
          plan: [
            {
              id: "plan-1",
              title: "Identify the project",
              criterion:
                "The project identity is supported by workspace evidence.",
              status: "active",
            },
          ],
          phase: {
            kind: "approval",
            steps: [],
            prompt: {
              id: "call-1",
              action: "Read project manifest",
              target: "package.json",
              reason: "Use package metadata to identify the current project.",
              command: 'read_file({"path":"package.json"})',
            },
          },
        },
      ],
    });

    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      screen.getAllByRole("article", { name: "Zhiyin response" }),
    ).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Work trace" })).toBeNull();
    expect(screen.getByText("I’ll inspect the project file.")).toBeVisible();
    expect(screen.queryByText(/read_file/i)).toBeNull();
    const conversation = screen.getByRole("log", {
      name: "Task conversation",
    });
    const permission = screen.getByRole("region", {
      name: "Permission request",
    });
    const composer = screen.getByLabelText("Message Zhiyin").closest("form");
    expect(
      within(conversation).queryByRole("region", {
        name: "Permission request",
      }),
    ).toBeNull();
    expect(screen.getByRole("region", { name: "Task plan" })).toBeVisible();
    expect(composer).not.toBeNull();
    expect(
      permission.compareDocumentPosition(composer as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /**
   * The folder is the scope of everything the next message may authorise, so
   * it belongs with the message. It is also not something that may change out
   * from under a running turn or an open decision.
   */
  it("puts the folder picker in the composer and locks it during a decision", () => {
    const withPhase = (phase: WorkspaceTask["phase"]) =>
      createWorkspaceState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        workspace: { path: "C:/work/reports", name: "reports" },
        recentWorkspaces: [
          { path: "C:/work/reports", name: "reports" },
          { path: "C:/work/notes", name: "notes" },
        ],
        selectedTaskId: "task",
        tasks: [
          {
            id: "task",
            title: "Look at the reports",
            updatedLabel: "Now",
            messages: [{ id: "user", role: "user", text: "Look at these" }],
            phase,
          },
        ],
      });

    const { rerender } = render(
      <WorkspaceShell
        state={withPhase({
          kind: "completed",
          outcome: { title: "Done", summary: "Looked." },
        })}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    const picker = screen.getByRole("button", { name: /^Workspace folder/ });
    const composer = screen.getByLabelText("Message Zhiyin").closest("form");
    expect(composer?.contains(picker)).toBe(true);
    expect(picker).toBeEnabled();

    rerender(
      <WorkspaceShell
        state={withPhase({
          kind: "approval",
          steps: [],
          prompt: {
            id: "call-1",
            action: "Read project manifest",
            target: "package.json",
            reason: "Identify the project.",
            command: 'read_file({"path":"package.json"})',
          },
        })}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      screen.getByRole("button", { name: /^Workspace folder/ }),
    ).toBeDisabled();
  });

  it("prevents the composer from starting an overlapping turn", () => {
    const interruptTask = vi.fn<CoreApi["interruptTask"]>(async () => {});
    const state = createWorkspaceState({
      connection: "ready",
      selectedTaskId: "running",
      tasks: [
        {
          id: "running",
          title: "Current task",
          updatedLabel: "Now",
          messages: [{ id: "user", role: "user", text: "Keep working" }],
          phase: {
            kind: "working",
            steps: [{ id: "model", label: "Ask the model", status: "active" }],
          },
        },
      ],
    });

    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={{ ...stubCommands, interruptTask }}
      />,
    );

    expect(screen.getByLabelText("Message Zhiyin")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
    expect(interruptTask).toHaveBeenCalledWith("running");
  });

  it("sends component switches through the core instead of keeping them local", () => {
    const setComponentEnabled = vi.fn<CoreApi["setComponentEnabled"]>(
      async () => {},
    );
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          surface: "library",
          runtime: { tasks: "available", capabilities: "available" },
          plugins: [
            {
              id: "research",
              name: "Deep Research & Synthesis",
              version: "1.0.0",
              description: "Find and check current facts.",
              category: "Research",
              publisher: "Zhiyin",
              source: "built-in",
              rollbackAvailable: false,
              enabled: true,
              editing: "override",
              status: "ready",
              defaultPrompts: [],
              components: [
                {
                  id: "research/source-triangulation",
                  kind: "skill",
                  name: "source-triangulation",
                  description: "Checks current facts.",
                  enabled: true,
                  status: "ready",
                  editing: "override",
                },
              ],
            },
          ],
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, setComponentEnabled }}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Turn off source-triangulation" }),
    );

    expect(setComponentEnabled).toHaveBeenCalledWith(
      "research/source-triangulation",
      false,
    );
  });

  it("returns the exact approval decision to the core", () => {
    const resolveApproval = vi.fn<CoreApi["resolveApproval"]>(async () => {});
    const state = createWorkspaceState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Read the notes",
          updatedLabel: "Now",
          messages: [{ id: "user", role: "user", text: "Read the notes" }],
          phase: {
            kind: "approval",
            steps: [],
            prompt: {
              id: "call-1",
              action: "Read a workspace file",
              target: "README.md",
              reason: "Use the project notes to answer the current question.",
              command: 'read_file({"path":"README.md"})',
            },
          },
        },
      ],
    });

    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={{
          createTask: async () => "task-1",
          selectTask: async () => {},
          renameTask: async () => {},
          deleteTask: async () => {},
          sendMessage: async () => {},
          interruptTask: async () => {},
          resolveApproval,
          resolveUserInput: async () => {},
          setComponentEnabled: async () => {},
          componentContent: async () => undefined,
          overrideComponent: async () => {},
          resetComponent: async () => {},
          installToolchain: async () => {},
          setPluginEnabled: async () => {},
          installPlugin: async () => ({ status: "cancelled" as const }),
          updatePlugin: async () => ({ status: "cancelled" as const }),
          rollbackPlugin: async () => {},
          removePlugin: async () => {},
          createPlugin: async () => {},
          savePluginContents: async () => {},
          editablePluginContents: async () => undefined,
          setMcpServerToolEnabled: async () => {},
          testMcpConnection: async () => ({
            ok: false,
            reason: "Not configured.",
          }),
          saveMcpServerToken: async () => {},
          clearMcpServerToken: async () => {},
          refreshConnections: async () => {},
          shellAvailability: async () => ({ available: true }),
          recheckShell: async () => ({ available: true }),
          openExternalUrl: async () => {},
          driveBrowser: async () => {},
          saveProviderApiKey: async () => ({ status: "accepted" as const }),
          clearProviderApiKey: async () => {},
          listModels: async () => ({ status: "ready", models: [] }),
          listModelProviders: async () => ({
            status: "unavailable",
            reason: "not in this test",
          }),
          selectModel: async () => {},
          previewArtifact: async () => ({
            status: "missing" as const,
            path: "",
            reason: "Not available in this test.",
          }),
          exportArtifact: async () => ({ status: "cancelled" as const }),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    expect(resolveApproval).toHaveBeenCalledWith("task-1", "call-1", "allow");
  });

  it("returns the exact structured answer to the core", () => {
    const resolveUserInput = vi.fn<CoreApi["resolveUserInput"]>(async () => {});
    const state = createWorkspaceState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Choose an audience",
          updatedLabel: "Now",
          messages: [{ id: "user", role: "user", text: "Prepare the release" }],
          phase: {
            kind: "input",
            steps: [],
            prompt: {
              id: "input-7",
              kind: "clarification",
              title: "Choose the audience",
              questions: [
                {
                  id: "audience",
                  prompt: "Who should receive it first?",
                  options: [
                    { id: "team", label: "Internal team" },
                    { id: "customers", label: "Customers" },
                  ],
                },
              ],
            },
          },
        },
      ],
    });

    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={{ ...stubCommands, resolveUserInput }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Internal team"));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    expect(resolveUserInput).toHaveBeenCalledWith("task-1", "input-7", {
      answers: [{ questionId: "audience", answerIds: ["team"] }],
    });
    expect(screen.getByLabelText("Message Zhiyin")).toBeDisabled();
  });

  it("returns the exact renewable work-budget choice to the core", () => {
    const resolveUserInput = vi.fn<CoreApi["resolveUserInput"]>(async () => {});
    const state = createWorkspaceState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Long inspection",
          updatedLabel: "Now",
          messages: [{ id: "user", role: "user", text: "Inspect everything" }],
          phase: {
            kind: "input",
            steps: [],
            prompt: {
              id: "budget-7",
              kind: "workBudget",
              title: "Continue working?",
              message:
                "The task completed 24 tool rounds and is ready for another action.",
              completedRounds: 24,
            },
          },
        },
      ],
    });

    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={{ ...stubCommands, resolveUserInput }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(resolveUserInput).toHaveBeenCalledWith("task-1", "budget-7", {
      answers: [{ questionId: "work-budget", answerIds: ["continue"] }],
    });
    expect(screen.getByLabelText("Message Zhiyin")).toBeDisabled();
    expect(
      screen.getByText("Choose whether the task should continue or pause"),
    ).toBeVisible();
  });

  it("keeps a pending quiz in the conversation scroll surface and locks the composer", () => {
    const state = createWorkspaceState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Constitution quiz",
          updatedLabel: "Now",
          messages: [{ id: "user", role: "user", text: "Quiz me" }],
          phase: {
            kind: "input",
            steps: [],
            prompt: {
              id: "quiz-7",
              kind: "quiz",
              title: "Institutions de la Ve République",
              questions: [
                {
                  id: "president",
                  prompt:
                    "Quels pouvoirs le Président exerce-t-il de manière propre, sans contreseing ministériel ?",
                  answers: [
                    { id: "appoint", label: "Il nomme le Premier ministre" },
                    {
                      id: "cabinet",
                      label: "Il préside le conseil des ministres",
                    },
                  ],
                  selection: "single",
                  correctAnswerIds: ["appoint"],
                  explanation:
                    "La nomination du Premier ministre relève des pouvoirs propres du Président.",
                },
              ],
            },
          },
        },
      ],
    });

    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    const conversation = screen.getByRole("log", {
      name: "Task conversation",
    });
    expect(
      within(conversation).getByRole("region", { name: "Quiz" }),
    ).toBeVisible();
    const composer = screen.getByLabelText("Message Zhiyin");
    expect(composer).toBeVisible();
    expect(composer).toBeDisabled();
    expect(screen.getByText("Answer the quiz first")).toBeVisible();
  });
});
