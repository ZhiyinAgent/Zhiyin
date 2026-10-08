import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, useMemo, useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  emptyConversationLists,
  type BrowserPanelState,
  type CoreApi,
  type DocumentPanelState,
  type TurnRemedy,
  type WorkspaceTask as CoreWorkspaceTask,
} from "@zhiyin/contract";
import {
  createWorkspaceState,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
  type WorkspaceTask,
} from "./workspaceState.js";
import { WorkspaceShell } from "./WorkspaceShell.js";

/** Every command the shell may reach for, doing nothing. */
const stubCommands: CoreApi = {
  frontendReady: async () => {},
  createTask: async () => "task-1",
  selectTask: async () => {},
  resendTask: async () => {},
  renameTask: async () => {},
  deleteTask: async () => {},
  sendMessage: async () => {},
  keepPaste: async () => ({ status: "refused", reason: "Not kept here." }),
  setContextBudget: async () => {},
  setDefaultContextBudget: async () => {},
  setPersonalInstructions: async () => {},
  setNotifications: async () => {},
  openDataFolder: async () => {},
  showInFolder: async () => {},
  setAppearance: async () => {},
  setSpelling: async () => {},
  keepPicture: async () => ({
    status: "refused" as const,
    reason: "Not in this test.",
  }),
  condenseNow: async () => {},
  openAttachment: async () => {},
  previewRewind: async () => {
    throw new Error("No rewind preview configured for this test.");
  },
  commitRewind: async () => ({ files: [] }),
  previewUndo: async () => {
    throw new Error("No undo preview configured for this test.");
  },
  commitUndo: async () => ({ files: [] }),
  compareDocument: async () => ({ after: [] }),
  interruptTask: async () => {},
  runningCommands: async () => [],
  commandOutput: async () => undefined,
  stopCommand: async () => {},
  resolveApproval: async () => {},
  revokeConversationPermission: async () => {},
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
  signInToMcpServer: async () => ({ status: "cancelled" }),
  cancelMcpSignIn: async () => {},
  refreshConnections: async () => {},
  checkMcpConnection: async () => {
    throw new Error("Not configured.");
  },
  shellAvailability: async () => ({ available: true }),
  recheckShell: async () => ({ available: true }),
  settleSavedConversations: async () => ({ done: 0, failed: 0 }),
  openExternalUrl: async () => {},
  driveBrowser: async () => {},

  chooseWorkspaceView: async () => {},
  showDocument: async () => ({ ok: true }),
  closeDocument: async () => {},
  drawDocumentPage: async () => ({ ok: false, reason: "Not drawn here." }),
  openDocument: async () => {},
  showDocumentInFolder: async () => {},
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
  exportConversation: async () => ({ status: "cancelled" }),
  onAppEvent: () => () => {},
  onViewCheck: () => () => {},
  answerViewCheck: async () => {},
};

describe("WorkspaceShell", () => {
  it("keeps the conversation and final answer beside the browser with the selector in the header", () => {
    const task = {
      id: "read",
      title: "Read a page",
      titleSource: "generated" as const,
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { id: "u", role: "user" as const, text: "Read this page", sequence: 0 },
      ],
      phase: { kind: "working" as const, steps: [] },
    };
    const window = besideConversation(
      createWorkspaceState({
        connection: "ready",
        tasks: [task],
        selectedTaskId: task.id,
        browser: openBrowser("frame"),
      }),
    );
    const selector = within(
      screen.getByRole("banner", { name: "Task header" }),
    ).getByRole("tab", { name: "Workspace" });
    fireEvent.click(selector);
    expect(window.chosen).toHaveBeenLastCalledWith("read", "browser");
    expect(
      screen.getByRole("log", { name: "Task conversation" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: /Preview — the page/ }),
    ).toBeVisible();
    window.send({
      type: "taskReplaced",
      task: {
        ...task,
        messages: [
          ...task.messages,
          {
            sequence: 1,
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
    });
    expect(screen.getByText("The comparison is ready.")).toBeVisible();
    expect(selector).toHaveAttribute("aria-selected", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "Return to conversation" }),
    );
    expect(window.chosen).toHaveBeenLastCalledWith("read", "conversation");
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
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { sequence: 0, id: "u", role: "user", text: "Research this page" },
      ],
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
      workspaceViews: { work: "browser" },
    });
    const { rerender } = render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={{ ...stubCommands, interruptTask }}
      />,
    );
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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
    expect(
      screen.getByText(
        "You stopped this. Send a message when you want to carry on.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
  });

  it("shows what the core says is beside the conversation, and passes the person's choice to it rather than keeping its own", () => {
    const window = besideConversation(
      createWorkspaceState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
      }),
    );
    expect(screen.queryByRole("tab", { name: "Workspace" })).toBeNull();

    // The core opens the space on the conversation's first browser.
    window.send({
      type: "browserChanged",
      taskId: "task",
      browser: openBrowser("first"),
    });
    window.send({
      type: "workspaceViewChanged",
      taskId: "task",
      view: "browser",
    });
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));
    expect(window.chosen).toHaveBeenLastCalledWith("task", "conversation");
    window.send({
      type: "browserChanged",
      taskId: "task",
      browser: openBrowser("next"),
    });

    // A new picture of the page is not a new view: only the core says that.
    expect(screen.getByRole("tab", { name: "Conversation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("says in the conversation that a browser is open, and opens it from there", () => {
    const window = besideConversation(
      createWorkspaceState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        browser: openBrowser("first"),
      }),
    );

    const notice = screen.getByText("Zhiyin opened a browser.");
    expect(notice).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show workspace" }));

    expect(window.chosen).toHaveBeenLastCalledWith("task", "browser");
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByText("Zhiyin opened a browser.")).toBeNull();
  });

  it("marks the workspace tab while the browser is busy and the conversation is showing", () => {
    besideConversation(
      createWorkspaceState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        browser: { ...openBrowser("first"), loading: true },
        workspaceViews: { task: "browser" },
      }),
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
    const driveBrowser = vi.fn();
    const window = besideConversation(
      createWorkspaceState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        browser: openBrowser("first"),
      }),
      { driveBrowser },
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
    window.send({
      type: "browserChanged",
      taskId: "task",
      browser: openBrowser("next"),
    });
    const conversationTab = screen.getByRole("tab", { name: "Conversation" });
    fireEvent.keyDown(conversationTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveFocus();
    expect(
      screen.getByRole("img", { name: /Preview — the page/ }),
    ).toHaveAttribute("src", "data:image/jpeg;base64,next");
    expect(driveBrowser).not.toHaveBeenCalled();
    window.send({
      type: "browserChanged",
      taskId: "task",
      browser: { status: "closed", url: "", title: "", loading: false },
    });
    window.send({
      type: "workspaceViewChanged",
      taskId: "task",
      view: "conversation",
    });
    expect(screen.queryByRole("tab", { name: "Workspace" })).toBeNull();
    expect(
      screen.getByRole("log", { name: "Task conversation" }),
    ).toBeVisible();
    expect(composer).toHaveValue("Keep my draft");
    window.send({
      type: "browserChanged",
      taskId: "task",
      browser: openBrowser("first"),
    });
    expect(screen.getByRole("tab", { name: "Conversation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("opens a cited page through the core when the person clicks the citation, and says why when the core refuses", async () => {
    const showDocument = vi.fn(
      async (_task: string, _path: string, page?: number) =>
        page === 24
          ? { ok: true as const }
          : {
              ok: false as const,
              reason: "q3.pdf has 30 pages, so there is no page 99.",
            },
    );
    besideConversation(
      createWorkspaceState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [
          {
            ...draft("task"),
            messages: [
              { sequence: 0, id: "u", role: "user", text: "Which page?" },
              {
                sequence: 1,
                id: "a",
                role: "assistant",
                text: "It is on [page 24](reports/q3.pdf#page=24), not [page 99](reports/q3.pdf#page=99).",
              },
            ],
            phase: {
              kind: "completed",
              outcome: { title: "Answered", summary: "Done" },
            },
          },
        ],
        selectedTaskId: "task",
      }),
      { showDocument },
    );

    fireEvent.click(screen.getByRole("button", { name: /^page 24/ }));
    await waitFor(() =>
      expect(showDocument).toHaveBeenCalledWith("task", "reports/q3.pdf", 24),
    );

    fireEvent.click(screen.getByRole("button", { name: /^page 99/ }));
    expect(
      await screen.findByText("q3.pdf has 30 pages, so there is no page 99."),
    ).toBeVisible();
  });

  it("shows a document beside the conversation, and offers Browser and Document when both are open, closing neither", () => {
    const closeDocument = vi.fn(async () => undefined);
    const driveBrowser = vi.fn();
    const window = besideConversation(
      createWorkspaceState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        browser: openBrowser("first"),
        documents: { task: shownReport },
        workspaceViews: { task: "document" },
      }),
      { closeDocument, driveBrowser },
    );
    expect(screen.getByRole("heading", { name: "q3.pdf" })).toBeVisible();
    const switcher = screen.getByRole("group", {
      name: "Show beside the conversation",
    });
    expect(
      within(switcher).getByRole("button", { name: "Document" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(switcher).getByRole("button", { name: "Browser" }));
    expect(window.chosen).toHaveBeenLastCalledWith("task", "browser");
    expect(
      screen.getByRole("img", { name: /Preview — the page/ }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "q3.pdf" })).toBeNull();

    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Show beside the conversation" }),
      ).getByRole("button", { name: "Document" }),
    );
    expect(screen.getByRole("heading", { name: "q3.pdf" })).toBeVisible();
    expect(closeDocument).not.toHaveBeenCalled();
    expect(driveBrowser).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close document" }));
    expect(closeDocument).toHaveBeenCalledWith("task");
  });

  it("says in the conversation which document is beside it, and shows it from there", () => {
    const window = besideConversation(
      createWorkspaceState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        documents: { task: shownReport },
        workspaceViews: { task: "conversation" },
      }),
    );
    expect(screen.getByText("q3.pdf is open in the workspace.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show workspace" }));
    expect(window.chosen).toHaveBeenLastCalledWith("task", "document");
    expect(screen.getByRole("heading", { name: "q3.pdf" })).toBeVisible();
  });

  it("opens a document in its own app or its folder through the core, for the conversation it belongs to", () => {
    const openDocument = vi.fn(async () => undefined);
    const showDocumentInFolder = vi.fn(async () => undefined);
    besideConversation(
      createWorkspaceState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        documents: { task: shownReport },
        workspaceViews: { task: "document" },
      }),
      { openDocument, showDocumentInFolder },
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(openDocument).toHaveBeenCalledWith("task", "out/q3.pdf");
    expect(showDocumentInFolder).toHaveBeenCalledWith("task", "out/q3.pdf");
  });

  it("shows a produced PDF beside the conversation from the files list, and says why when it cannot", async () => {
    const showDocument = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        reason: "out/q3.pdf is outside the folder this conversation works in.",
      });
    besideConversation(
      createWorkspaceState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [
          {
            ...draft("task"),
            artifacts: [
              {
                path: "out/q3.pdf",
                name: "q3.pdf",
                change: "created",
                bytes: 4_000,
                updatedAt: "2026-10-03T09:00:00.000Z",
              },
            ],
          },
        ],
        selectedTaskId: "task",
      }),
      { showDocument },
    );
    const show = () => {
      fireEvent.click(screen.getByRole("button", { name: /^Files/ }));
      fireEvent.click(
        screen.getByRole("button", {
          name: "Show q3.pdf beside the conversation",
        }),
      );
    };
    show();
    await waitFor(() =>
      expect(showDocument).toHaveBeenCalledWith("task", "out/q3.pdf"),
    );
    expect(
      screen.queryByRole("region", { name: "Files this task produced" }),
    ).toBeNull();

    show();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "out/q3.pdf is outside the folder this conversation works in.",
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
        workspaceViews: { "preview-task": "browser" },
        tasks: [
          {
            id: "preview-task",
            title: "Preview",
            updatedLabel: "Now",
            updatedAt: "2026-10-05T09:00:00.000Z",
            ...emptyConversationLists,
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
      fireEvent.click(screen.getByRole("tab", { name: "Workspace" }));
      expect(
        screen.getAllByRole("region", { name: "Permission request" }),
      ).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Show details" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: decision }));
      if (decision === "Deny")
        fireEvent.click(screen.getByRole("button", { name: "Confirm denial" }));
      await waitFor(() =>
        expect(resolveApproval).toHaveBeenCalledWith(
          "preview-task",
          "read-page",
          decision === "Allow once" ? "allow" : "deny",
        ),
      );
    },
  );

  it("keeps raw reasoning out of view and passes the selected effort to the core", async () => {
    const task: WorkspaceTask = {
      id: "reasoning",
      title: "Research",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { sequence: 0, id: "u", role: "user", text: "Research this" },
        {
          sequence: 1,
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
    expect(screen.queryByText("Comparing sources.")).not.toBeInTheDocument();
    expect(screen.getByText("Working")).toBeVisible();
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
    expect(screen.queryByText("Comparing sources.")).not.toBeInTheDocument();
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
  it("edits a message where it is, then goes back and sends the new words, keeping what came before", async () => {
    const commitRewind = vi.fn(async () => ({ files: [] }));
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
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
              updatedAt: "2026-10-05T09:00:00.000Z",
              ...emptyConversationLists,
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
            laterUserMessages: 0,
            discardedActions: [],
            files: [],
          }),
          commitRewind,
          sendMessage,
        }}
      />,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Edit this message" })[1]!,
    );
    const field = screen.getByRole("textbox", { name: "Edit your message" });
    expect(field).toHaveValue("Make it shorter");
    expect(commitRewind).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "Make it much shorter" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        "task-1",
        "Make it much shorter",
        undefined,
      ),
    );
    expect(commitRewind).toHaveBeenCalledWith("task-1", "rewind-1", "keep");
    expect(screen.getByText("Here is a draft.")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Message Zhiyin" })).toHaveValue(
      "",
    );
  });

  it("sends an edited message with the pastes it carried", async () => {
    const paste = {
      kind: "pastedText" as const,
      id: "pasted-2026-09-24-101500.txt",
      bytes: 48_000,
      lines: 1_200,
    };
    const openAttachment = vi.fn<CoreApi["openAttachment"]>(async () => {});
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          tasks: [
            {
              id: "task-1",
              title: "Read a log",
              updatedLabel: "Now",
              updatedAt: "2026-10-05T09:00:00.000Z",
              ...emptyConversationLists,
              messages: [
                {
                  id: "message-1",
                  role: "user",
                  text: "Summarise this",
                  attachments: [paste],
                  sequence: 0,
                },
                {
                  id: "message-2",
                  role: "assistant",
                  text: "A summary.",
                  sequence: 1,
                },
              ],
              phase: {
                kind: "completed",
                outcome: { title: "Done", summary: "Summarised." },
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
            messageId: "message-1",
            draft: "Summarise this",
            discardedMessages: 2,
            laterUserMessages: 0,
            discardedActions: [],
            files: [],
          }),
          openAttachment,
          sendMessage,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit this message" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Edit your message" }),
      {
        target: { value: "Summarise this briefly" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        "task-1",
        "Summarise this briefly",
        undefined,
        [paste.id],
      ),
    );
  });

  it("resends a message whose reply was only text: the same words and pastes, with nothing left in the composer", async () => {
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    const commitRewind = vi.fn(async () => ({ files: [] }));
    render(
      <WorkspaceShell
        state={answered()}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          previewRewind: async () => onlyItsReply,
          commitRewind,
          sendMessage,
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Resend this message" }),
    );

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        "task-1",
        "Summarise this",
        { enabled: true, effort: "high" },
        [pasted.id],
      ),
    );
    expect(commitRewind).toHaveBeenCalledWith("task-1", "rewind-1", "keep");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message Zhiyin" })).toHaveValue(
      "",
    );
  });

  it("puts a resent message back in the composer, with its pastes, when it could not be sent", async () => {
    const dispatch = vi.fn();
    render(
      <WorkspaceShell
        state={answered()}
        dispatch={dispatch}
        commands={{
          ...stubCommands,
          previewRewind: async () => onlyItsReply,
          sendMessage: async () => {
            throw new Error("No model is selected.");
          },
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Resend this message" }),
    );

    const field = screen.getByRole("textbox", { name: "Message Zhiyin" });
    await waitFor(() => expect(field).toHaveValue("Summarise this"));
    expect(
      within(field.closest("form")!).getByRole("button", {
        name: /Open pasted text/,
      }),
    ).toBeVisible();
    expect(dispatch).toHaveBeenCalledWith({
      type: "commandErrorShown",
      message:
        "The message was not sent again: No model is selected. It is back in the message box.",
    });
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
              updatedAt: "2026-10-05T09:00:00.000Z",
              ...emptyConversationLists,
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

  it.each(["Permissions", "Export…"])(
    "closes mobile navigation when a conversation's %s dialog opens",
    (item) => {
      render(
        <WorkspaceShell
          state={createWorkspaceState({
            connection: "ready",
            runtime: { tasks: "available", capabilities: "available" },
            tasks: [
              {
                id: "budget",
                title: "Budget 2026",
                updatedAt: "2026-10-05T09:00:00.000Z",
                updatedLabel: "9m",
                ...emptyConversationLists,
                messages: [],
                phase: { kind: "draft" },
              },
            ],
          })}
          dispatch={() => undefined}
          commands={stubCommands}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Options for Budget 2026" }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name: item }));

      expect(screen.getByRole("dialog")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Open navigation" }),
      ).toBeVisible();
    },
  );

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
              updatedAt: "2026-10-05T09:00:00.000Z",
              ...emptyConversationLists,
              messages: [
                {
                  sequence: 0,
                  id: "m1",
                  role: "user",
                  text: "Write the brief",
                },
              ],
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
          keepPaste: async () => ({
            status: "refused",
            reason: "Not kept here.",
          }),
          openAttachment: async () => {},
          setContextBudget: async () => {},
          setDefaultContextBudget: async () => {},
          setPersonalInstructions: async () => {},
          condenseNow: async () => {},
          interruptTask: async () => {},
          runningCommands: async () => [],
          commandOutput: async () => undefined,
          stopCommand: async () => {},
          resolveApproval: async () => {},
          revokeConversationPermission: async () => {},
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
          signInToMcpServer: async () => ({ status: "cancelled" }),
          cancelMcpSignIn: async () => {},
          refreshConnections: async () => {},
          checkMcpConnection: async () => {
            throw new Error("Not configured.");
          },
          shellAvailability: async () => ({ available: true }),
          recheckShell: async () => ({ available: true }),
          openExternalUrl: async () => {},
          driveBrowser: async () => {},
          chooseWorkspaceView: async () => {},
          showDocument: async () => ({ ok: true as const }),
          closeDocument: async () => {},
          drawDocumentPage: async () => ({
            ok: false as const,
            reason: "Not drawn here.",
          }),
          openDocument: async () => {},
          showDocumentInFolder: async () => {},
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
   * A snapshot carries which conversation is open. Unless the core is told one
   * was left for a new one, the next snapshot to arrive (after choosing a
   * folder, say) puts the old one back.
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
              updatedAt: "2026-10-05T09:00:00.000Z",
              ...emptyConversationLists,
              messages: [
                { sequence: 0, id: "m1", role: "user", text: "Hello" },
              ],
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

  it("sends a long paste by the name it was kept as, and opens it from the message after", async () => {
    const paste = {
      kind: "pastedText" as const,
      id: "pasted-2026-09-24-101500.txt",
      bytes: 48_000,
      lines: 1_200,
    };
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    const openAttachment = vi.fn<CoreApi["openAttachment"]>(async () => {});
    const commands = {
      ...stubCommands,
      createTask: async () => "task-new",
      sendMessage,
      openAttachment,
      keepPaste: async () => ({ status: "kept" as const, attachment: paste }),
    };
    const { rerender } = render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
        })}
        dispatch={() => undefined}
        commands={commands}
      />,
    );

    fireEvent.paste(screen.getByLabelText("Message Zhiyin"), {
      clipboardData: { getData: () => "x".repeat(15_000) },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /Open pasted text/ }),
    );
    expect(openAttachment).toHaveBeenLastCalledWith(null, paste.id);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith("task-new", "", undefined, [
        paste.id,
      ]),
    );

    const task: WorkspaceTask = {
      id: "task-new",
      title: "Pasted text",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { sequence: 0, id: "u", role: "user", text: "", attachments: [paste] },
      ],
      phase: { kind: "working", steps: [] },
    };
    rerender(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          tasks: [task],
          selectedTaskId: task.id,
        })}
        dispatch={() => undefined}
        commands={commands}
      />,
    );
    fireEvent.click(
      within(screen.getByRole("log", { name: "Task conversation" })).getByRole(
        "button",
        { name: /Open pasted text/ },
      ),
    );
    expect(openAttachment).toHaveBeenLastCalledWith("task-new", paste.id);
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

  it("shows how full the conversation is and sends a budget change to the core", () => {
    const setContextBudget = vi.fn<CoreApi["setContextBudget"]>(async () => {});
    const task: WorkspaceTask = {
      id: "measured",
      title: "Measured",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [{ sequence: 0, id: "u", role: "user", text: "Look" }],
      phase: { kind: "interrupted" },
      contextBudget: "ultra",
      contextUsage: {
        model: "wide",
        totalTokens: 425_000,
        measured: true,
        parts: {
          instructions: 1_000,
          tools: 4_000,
          summary: 0,
          conversation: 400_000,
          toolResults: 20_000,
        },
      },
    };
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          selectedTaskId: task.id,
          tasks: [task],
          runtime: { tasks: "available", capabilities: "available" },
          contextBudget: "low",
          provider: {
            ...createWorkspaceState().provider,
            contextWindow: 1_000_000,
          },
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, setContextBudget }}
      />,
    );

    // The conversation's own choice wins over the app's default.
    const ring = screen.getByRole("button", { name: /^Context/ });
    expect(ring).toHaveAccessibleName("Context: 50% of the Ultra budget");
    fireEvent.click(ring);
    fireEvent.click(screen.getByRole("radio", { name: /Medium/ }));

    expect(setContextBudget).toHaveBeenCalledWith("measured", "medium");
  });

  it("shows in the conversation and on its ring that the core is compacting it, until it says it has finished", () => {
    const task: CoreWorkspaceTask = {
      id: "long",
      title: "Long",
      titleSource: "manual",
      updatedLabel: "Now",
      updatedAt: "2026-10-07T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [{ sequence: 0, id: "u", role: "user", text: "Look" }],
      phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
    };
    const hydrated = (compacting?: readonly string[]) =>
      workspaceReducer(createWorkspaceState(), {
        type: "workspaceHydrated",
        snapshot: {
          runtime: { tasks: "available", capabilities: "available" },
          recentWorkspaces: [],
          selectedTaskId: task.id,
          tasks: [task],
          plugins: [],
          mcpServers: [],
          usage: { status: "unavailable", reason: "No usage yet." },
          ...(compacting ? { compacting } : {}),
        },
      });
    const shown = (state: WorkspaceState) => (
      <WorkspaceShell
        state={{ ...state, connection: "ready" }}
        dispatch={() => undefined}
        commands={stubCommands}
      />
    );

    const { rerender } = render(shown(hydrated([task.id])));
    expect(
      screen.getByText("Compacting the earlier conversation"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^Context/ })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    rerender(shown(hydrated()));
    expect(
      screen.queryByText("Compacting the earlier conversation"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Context/ }),
    ).not.toHaveAttribute("aria-busy");
  });

  it("keeps the person's own instructions in Custom instructions, and the ring's breakdown leads back there", async () => {
    const setPersonalInstructions = vi.fn<CoreApi["setPersonalInstructions"]>(
      async () => {},
    );
    const dispatch = vi.fn();
    const task: WorkspaceTask = {
      id: "task-1",
      title: "Reports",
      updatedLabel: "now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [],
      phase: { kind: "interrupted" },
      contextUsage: {
        model: "wide",
        totalTokens: 10_000,
        measured: true,
        parts: {
          instructions: 1_000,
          tools: 1_000,
          summary: 0,
          conversation: 8_000,
          toolResults: 0,
        },
      },
      standingInstructions: [
        {
          source: "personal",
          text: "Always answer in French.",
          bytes: 24,
          truncated: false,
        },
      ],
    };
    const { rerender } = render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          tasks: [task],
          selectedTaskId: "task-1",
        })}
        dispatch={dispatch}
        commands={{ ...stubCommands, setPersonalInstructions }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Context/ }));
    fireEvent.click(screen.getByRole("button", { name: "What's using space" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit custom instructions" }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "surfaceOpened",
      surface: "instructions",
    });

    rerender(
      <WorkspaceShell
        state={{
          ...createWorkspaceState({
            connection: "ready",
            runtime: { tasks: "available", capabilities: "available" },
            surface: "instructions",
          }),
          personalInstructions: "Always answer in French.",
        }}
        dispatch={dispatch}
        commands={{ ...stubCommands, setPersonalInstructions }}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Your instructions" });
    expect(field).toHaveValue("Always answer in French.");
    fireEvent.change(field, { target: { value: "Answer in German." } });
    fireEvent.click(screen.getByRole("button", { name: "Save instructions" }));

    await waitFor(() =>
      expect(setPersonalInstructions).toHaveBeenCalledWith("Answer in German."),
    );
  });

  it("makes a budget chosen before the first message the default, and fixes it on the conversation that message starts", async () => {
    const createTask = vi.fn<CoreApi["createTask"]>(async () => "task-new");
    const setContextBudget = vi.fn<CoreApi["setContextBudget"]>(async () => {});
    const setDefaultContextBudget = vi.fn<CoreApi["setDefaultContextBudget"]>(
      async () => {},
    );
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          provider: {
            ...createWorkspaceState().provider,
            contextWindow: 1_000_000,
          },
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          createTask,
          setContextBudget,
          setDefaultContextBudget,
          sendMessage,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Context/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Low/ }));
    expect(setDefaultContextBudget).toHaveBeenCalledWith("low");
    expect(createTask).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /Low/ })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Start" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(setContextBudget).toHaveBeenCalledWith("task-new", "low");
    expect(setContextBudget.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]!,
    );
  });

  it("starts a new conversation on the default, fixed on it so a later default leaves it alone", async () => {
    const createTask = vi.fn<CoreApi["createTask"]>(async () => "task-new");
    const setContextBudget = vi.fn<CoreApi["setContextBudget"]>(async () => {});
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          contextBudget: "ultra",
          provider: {
            ...createWorkspaceState().provider,
            contextWindow: 1_000_000,
          },
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          createTask,
          setContextBudget,
          sendMessage,
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Start" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(setContextBudget).toHaveBeenCalledWith("task-new", "ultra");
  });

  it("changes only the open conversation when its budget is chosen, never the default", () => {
    const setContextBudget = vi.fn<CoreApi["setContextBudget"]>(async () => {});
    const setDefaultContextBudget = vi.fn<CoreApi["setDefaultContextBudget"]>(
      async () => {},
    );
    const other: WorkspaceTask = {
      id: "other",
      title: "Other",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [{ sequence: 0, id: "u", role: "user", text: "Hi" }],
      phase: { kind: "interrupted" },
    };
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          selectedTaskId: other.id,
          tasks: [other],
          runtime: { tasks: "available", capabilities: "available" },
          provider: {
            ...createWorkspaceState().provider,
            contextWindow: 1_000_000,
          },
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          setContextBudget,
          setDefaultContextBudget,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Context/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Ultra/ }));

    expect(setContextBudget).toHaveBeenCalledWith("other", "ultra");
    expect(setDefaultContextBudget).not.toHaveBeenCalled();
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
          keepPaste: async () => ({
            status: "refused",
            reason: "Not kept here.",
          }),
          openAttachment: async () => {},
          setContextBudget: async () => {},
          setDefaultContextBudget: async () => {},
          setPersonalInstructions: async () => {},
          condenseNow: async () => {},
          interruptTask: async () => {},
          runningCommands: async () => [],
          commandOutput: async () => undefined,
          stopCommand: async () => {},
          resolveApproval: async () => {},
          revokeConversationPermission: async () => {},
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
          signInToMcpServer: async () => ({ status: "cancelled" }),
          cancelMcpSignIn: async () => {},
          refreshConnections: async () => {},
          checkMcpConnection: async () => {
            throw new Error("Not configured.");
          },
          shellAvailability: async () => ({ available: true }),
          recheckShell: async () => ({ available: true }),
          openExternalUrl: async () => {},
          driveBrowser: async () => {},
          chooseWorkspaceView: async () => {},
          showDocument: async () => ({ ok: true as const }),
          closeDocument: async () => {},
          drawDocumentPage: async () => ({
            ok: false as const,
            reason: "Not drawn here.",
          }),
          openDocument: async () => {},
          showDocumentInFolder: async () => {},
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
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            {
              sequence: 0,
              id: "user",
              role: "user",
              text: "Summarize the project",
            },
            { sequence: 1, id: "assistant", role: "assistant", text: answer },
          ],
          actions: [
            {
              sequence: 100,
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
   * sends is often a blank line. Drawn, that would be an empty response bubble
   * beside the "Working" one — two marks in the margin for one turn, one of
   * them with nothing under it.
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
            updatedAt: "2026-10-05T09:00:00.000Z",
            ...emptyConversationLists,
            messages: [
              {
                sequence: 0,
                id: "m1",
                role: "user",
                text: "Summarise the directory",
              },
              { sequence: 1, id: "m2", role: "assistant", text },
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
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
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
            updatedAt: "2026-10-05T09:00:00.000Z",
            ...emptyConversationLists,
            messages: [
              {
                sequence: 0,
                id: "user",
                role: "user",
                text: "Explain the project",
              },
              { sequence: 1, id: "assistant", role: "assistant", text },
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

    fireEvent.wheel(conversation, { deltaY: -900 });
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

  it("says the conversation is waiting on the specialists still running once the turn has finished", () => {
    const specialist = (id: string, name: string) => ({
      id,
      name,
      description: `${name}.`,
      instructions: "Check.",
      provenance: { source: "plugin" as const, pluginId: "research" },
    });
    const state = createWorkspaceState({
      connection: "ready",
      selectedTaskId: "task",
      tasks: [
        {
          id: "task",
          title: "Check the reports",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            {
              sequence: 0,
              id: "user",
              role: "user",
              text: "Check the reports",
            },
            {
              sequence: 1,
              id: "assistant",
              role: "assistant",
              text: "The fact-checker is on it.",
            },
          ],
          specialistRuns: [
            {
              sequence: 400,
              id: "run-1",
              specialist: specialist("fact-checker", "Fact-checker"),
              task: "Check every figure.",
              depth: 1,
              status: "running",
              startedAt: new Date().toISOString(),
              actionIds: ["a1", "a2"],
            },
            {
              sequence: 401,
              id: "run-2",
              specialist: specialist("researcher", "Researcher"),
              task: "Find the sources.",
              depth: 1,
              status: "completed",
              startedAt: new Date().toISOString(),
              actionIds: ["a3"],
            },
          ],
          phase: {
            kind: "completed",
            outcome: { title: "Waiting", summary: "Waiting on a specialist." },
            backgroundSpecialistIds: ["run-1"],
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

    const waiting = screen
      .getAllByRole("status")
      .filter((status) => status.textContent?.startsWith("Waiting for"));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toHaveTextContent(/^Waiting for Fact-checker · 2 calls/);
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
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            {
              sequence: 0,
              id: "user",
              role: "user",
              text: "Read package.json",
            },
            {
              sequence: 1,
              id: "assistant",
              role: "assistant",
              text: "I’ll inspect the project file.",
            },
          ],
          plan: [
            {
              id: "plan-1",
              title: "Identify the project",
              status: "in_progress",
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
    const plan = screen.getByRole("button", { name: /^plan \d+\/\d+/i });
    expect(plan).toBeVisible();
    expect(plan).toHaveTextContent("Identify the project");
    expect(
      within(conversation).queryByRole("button", { name: /^plan \d+\/\d+/i }),
    ).toBeNull();
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
            updatedAt: "2026-10-05T09:00:00.000Z",
            ...emptyConversationLists,
            messages: [
              { sequence: 0, id: "user", role: "user", text: "Look at these" },
            ],
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

  it("shows the shown conversation's running commands in its header, and lets the person stop one", async () => {
    const stopCommand = vi.fn<CoreApi["stopCommand"]>(async () => {});
    const build = {
      id: "J1",
      command: "npm run build",
      explanation: "Builds the app.",
      startedAt: Date.now(),
    };
    const state = createWorkspaceState({
      connection: "ready",
      selectedTaskId: "work",
      runtime: { tasks: "available", capabilities: "available" },
      tasks: [
        {
          id: "work",
          title: "Build it",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [{ sequence: 0, id: "user", role: "user", text: "Build" }],
          phase: { kind: "draft" },
        },
      ],
      runningCommands: { work: [build], other: [build, build] },
    });

    render(
      <WorkspaceShell
        state={state}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          runningCommands: async () => [build],
          stopCommand,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1 command running" }));
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Running commands" }),
      ).getByRole("button", { name: "Stop npm run build" }),
    );
    await waitFor(() => expect(stopCommand).toHaveBeenCalledWith("work", "J1"));
  });

  it("prevents the composer from starting an overlapping turn", () => {
    const interruptTask = vi.fn<CoreApi["interruptTask"]>(async () => {});
    const state = createWorkspaceState({
      connection: "ready",
      selectedTaskId: "running",
      runtime: { tasks: "available", capabilities: "available" },
      tasks: [
        {
          id: "running",
          title: "Current task",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            { sequence: 0, id: "user", role: "user", text: "Keep working" },
          ],
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

    expect(screen.getByLabelText("Message Zhiyin")).toBeEnabled();
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
      screen.getByRole("switch", { name: "Source triangulation: on" }),
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
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            { sequence: 0, id: "user", role: "user", text: "Read the notes" },
          ],
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
          keepPaste: async () => ({
            status: "refused",
            reason: "Not kept here.",
          }),
          openAttachment: async () => {},
          setContextBudget: async () => {},
          setDefaultContextBudget: async () => {},
          setPersonalInstructions: async () => {},
          condenseNow: async () => {},
          interruptTask: async () => {},
          runningCommands: async () => [],
          commandOutput: async () => undefined,
          stopCommand: async () => {},
          resolveApproval,
          revokeConversationPermission: async () => {},
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
          signInToMcpServer: async () => ({ status: "cancelled" }),
          cancelMcpSignIn: async () => {},
          refreshConnections: async () => {},
          checkMcpConnection: async () => {
            throw new Error("Not configured.");
          },
          shellAvailability: async () => ({ available: true }),
          recheckShell: async () => ({ available: true }),
          openExternalUrl: async () => {},
          driveBrowser: async () => {},
          chooseWorkspaceView: async () => {},
          showDocument: async () => ({ ok: true as const }),
          closeDocument: async () => {},
          drawDocumentPage: async () => ({
            ok: false as const,
            reason: "Not drawn here.",
          }),
          openDocument: async () => {},
          showDocumentInFolder: async () => {},
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
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            {
              sequence: 0,
              id: "user",
              role: "user",
              text: "Prepare the release",
            },
          ],
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
    expect(screen.getByLabelText("Message Zhiyin")).toBeEnabled();
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
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            {
              sequence: 0,
              id: "user",
              role: "user",
              text: "Inspect everything",
            },
          ],
          phase: {
            kind: "input",
            steps: [],
            prompt: {
              id: "budget-7",
              kind: "workBudget",
              title: "Keep working on this?",
              completedRounds: 24,
              reached: ["toolRounds"],
              elapsedMs: 600_000,
              allowance: {
                toolRounds: 24,
                elapsedMs: 1_800_000,
                providerCostUsd: 10,
              },
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

    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));

    expect(resolveUserInput).toHaveBeenCalledWith("task-1", "budget-7", {
      answers: [{ questionId: "work-budget", answerIds: ["continue"] }],
    });
    expect(screen.getByLabelText("Message Zhiyin")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop task" })).toBeEnabled();
  });

  it("keeps a pending quiz visible while accepting guidance", () => {
    const state = createWorkspaceState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Constitution quiz",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            { sequence: 0, id: "user", role: "user", text: "Quiz me" },
          ],
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
    expect(composer).toBeEnabled();
  });

  it("exports a conversation from its menu in the format the person chooses, and shows where it went", async () => {
    const destination = "C:\\Users\\sam\\Documents\\Budget 2026.json";
    const exportConversation = vi.fn(async () => ({
      status: "saved" as const,
      destination,
    }));
    const showInFolder = vi.fn(async () => {});
    render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          conversations: [
            {
              id: "budget",
              title: "Budget 2026",
              titleSource: "generated",
              updatedAt: "2026-10-05T09:00:00.000Z",
              updatedLabel: "9m",
            },
          ],
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, exportConversation, showInFolder }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Options for Budget 2026" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Export…" }));
    const dialog = screen.getByRole("dialog", { name: "Export conversation" });
    expect(within(dialog).getByText("Budget 2026")).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /Data to analyse/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Export…" }));

    expect(await within(dialog).findByText("Saved")).toBeVisible();
    expect(exportConversation).toHaveBeenCalledWith("budget", "json");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show in folder" }),
    );
    expect(showInFolder).toHaveBeenCalledWith(destination);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("deleting a conversation", () => {
    const damaged = () =>
      createWorkspaceState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        conversations: [
          {
            id: "task-9",
            title: "Rapport maternelle",
            titleSource: "generated",
            updatedAt: "2026-10-05T09:00:00.000Z",
            updatedLabel: "9m",
          },
        ],
        selectedTaskId: "task-9",
        issues: [
          {
            message:
              "“Rapport maternelle” is damaged and can't be opened. Your other conversations are unaffected.",
            conversationId: "task-9",
            canDelete: true,
          },
        ],
      });

    it("shows a damaged conversation's report in its place, without suggestions or a composer", () => {
      render(
        <WorkspaceShell
          state={damaged()}
          dispatch={() => undefined}
          commands={stubCommands}
        />,
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "“Rapport maternelle” is damaged and can't be opened.",
      );
      expect(screen.queryByText("What should we work on?")).toBeNull();
      expect(screen.getByLabelText("Message Zhiyin")).not.toBeVisible();
    });

    it("replaces one conversation's report with the next one's", () => {
      const state = damaged();
      const both = {
        ...state,
        conversations: [
          ...(state.conversations ?? []),
          {
            id: "task-8",
            title: "Budget 2026",
            titleSource: "generated" as const,
            updatedAt: "2026-10-05T09:00:00.000Z",
            updatedLabel: "9m",
          },
        ],
        issues: [
          ...(state.issues ?? []),
          {
            message:
              "“Budget 2026” is damaged and can't be opened. Your other conversations are unaffected.",
            conversationId: "task-8",
            canDelete: true as const,
          },
        ],
      };
      const { rerender } = render(
        <WorkspaceShell
          state={both}
          dispatch={() => undefined}
          commands={stubCommands}
        />,
      );
      expect(screen.getAllByRole("alert")).toHaveLength(1);

      rerender(
        <WorkspaceShell
          state={{ ...both, selectedTaskId: "task-8" }}
          dispatch={() => undefined}
          commands={stubCommands}
        />,
      );

      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent("“Budget 2026”");
    });

    it("says the conversation was deleted once the core has deleted it", async () => {
      const deleteTask = vi.fn<CoreApi["deleteTask"]>(async () => {});
      render(
        <WorkspaceShell
          state={damaged()}
          dispatch={() => undefined}
          commands={{ ...stubCommands, deleteTask }}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Delete conversation" }),
      );

      expect(deleteTask).toHaveBeenCalledWith("task-9");
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "Deleted “Rapport maternelle”.",
        ),
      );
    });

    it("says nothing was deleted when the core could not delete it", async () => {
      const dispatch = vi.fn();
      render(
        <WorkspaceShell
          state={damaged()}
          dispatch={dispatch}
          commands={{
            ...stubCommands,
            deleteTask: async () => {
              throw new Error("The conversation could not be deleted.");
            },
          }}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Delete conversation" }),
      );

      await waitFor(() =>
        expect(dispatch).toHaveBeenCalledWith({
          type: "commandErrorShown",
          message: "The conversation could not be deleted.",
        }),
      );
      expect(screen.queryByText(/Deleted “/)).toBeNull();
    });
  });
});

const pasted = {
  kind: "pastedText" as const,
  id: "pasted-2026-10-01-101500.txt",
  bytes: 48_000,
  lines: 1_200,
};

/** One request with a pasted log, answered in words only. */
function answered() {
  return createWorkspaceState({
    connection: "ready",
    runtime: { tasks: "available", capabilities: "available" },
    selectedTaskId: "task-1",
    tasks: [
      {
        id: "task-1",
        title: "Read a log",
        updatedLabel: "Now",
        updatedAt: "2026-10-05T09:00:00.000Z",
        ...emptyConversationLists,
        reasoning: { enabled: true, effort: "high" },
        messages: [
          {
            id: "message-1",
            role: "user",
            text: "Summarise this",
            attachments: [pasted],
            sequence: 0,
          },
          {
            id: "message-2",
            role: "assistant",
            text: "A summary.",
            sequence: 1,
          },
        ],
        phase: {
          kind: "completed",
          outcome: { title: "Done", summary: "Summarised." },
        },
      },
    ],
  });
}

const onlyItsReply = {
  id: "rewind-1",
  taskId: "task-1",
  messageId: "message-1",
  draft: "Summarise this",
  discardedMessages: 2,
  laterUserMessages: 0,
  discardedActions: [],
  files: [],
};

/** The shell with the real reducer, for flows that move between pages. */
function Live({
  initial,
  commands,
}: {
  initial: WorkspaceState;
  commands: CoreApi;
}) {
  const [state, dispatch] = useReducer(workspaceReducer, initial);
  return (
    <WorkspaceShell state={state} dispatch={dispatch} commands={commands} />
  );
}

/**
 * The shell over the real reducer, with a core that answers a choice of view
 * the way the real one does: by announcing the view. The window keeps no view
 * of its own, so a test that clicks a tab sees only what the core then says.
 */
function besideConversation(
  initial: WorkspaceState,
  overrides: Partial<CoreApi> = {},
) {
  let dispatchTo!: (action: WorkspaceAction) => void;
  const chosen = vi.fn();
  function Window() {
    const [state, dispatch] = useReducer(workspaceReducer, initial);
    useEffect(() => {
      dispatchTo = dispatch;
    }, [dispatch]);
    const commands = useMemo<CoreApi>(
      () => ({
        ...stubCommands,
        ...overrides,
        chooseWorkspaceView: async (taskId, view) => {
          chosen(taskId, view);
          dispatch({ type: "workspaceViewChanged", taskId, view });
        },
      }),
      [],
    );
    return (
      <WorkspaceShell state={state} dispatch={dispatch} commands={commands} />
    );
  }
  render(<Window />);
  return {
    chosen,
    /** Something the core announced. */
    send: (action: WorkspaceAction) => act(() => dispatchTo(action)),
  };
}

function openBrowser(frame: string): BrowserPanelState {
  return {
    status: "open",
    url: "https://example.com",
    title: "Preview",
    loading: false,
    frame: { data: frame, width: 1280, height: 800 },
  };
}

function draft(id: string): WorkspaceTask {
  return {
    id,
    title: "Report",
    updatedLabel: "Now",
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...emptyConversationLists,
    messages: [],
    phase: { kind: "draft" },
  };
}

const shownReport: DocumentPanelState = {
  path: "out/q3.pdf",
  name: "q3.pdf",
  folder: "out",
  status: "shown",
  documents: [{ path: "out/q3.pdf", name: "q3.pdf", folder: "out" }],
  revision: "r1",
  kind: "pdf",
  pages: [{ width: 612, height: 792 }],
  openable: true,
};

/** One request that failed, offering what the loop said it can do next. */
function failed(remedies?: readonly TurnRemedy[]) {
  return createWorkspaceState({
    connection: "ready",
    runtime: { tasks: "available", capabilities: "available" },
    selectedTaskId: "task-1",
    tasks: [
      {
        id: "task-1",
        title: "Summarise the notes",
        updatedLabel: "Now",
        updatedAt: "2026-10-05T09:00:00.000Z",
        ...emptyConversationLists,
        reasoning: { enabled: true, effort: "high" },
        messages: [
          {
            id: "message-1",
            role: "user",
            text: "Summarise the notes",
            sequence: 0,
          },
        ],
        phase: {
          kind: "failed",
          reason: "The model connection stopped. Try again.",
          ...(remedies ? { remedies } : {}),
        },
      },
    ],
  });
}

function failureNotice() {
  return screen
    .getByText("Task stopped with an error")
    .closest<HTMLElement>("[role=status]")!;
}

describe("a failed turn", () => {
  it.each([
    [["updateApiKey"], ["Update API key"]],
    [["openSettings"], ["Open the Model page"]],
    [["tryAgain"], ["Try again"]],
    [
      ["continue", "tryAgain"],
      ["Continue", "Try again"],
    ],
    [
      ["chooseModel", "tryAgain"],
      ["Choose a model", "Try again"],
    ],
    [
      ["chooseLargerModel", "tryAgain"],
      ["Choose a model with a larger window", "Try again"],
    ],
    [
      ["addCredits", "tryAgain"],
      ["Add OpenRouter credits", "Try again"],
    ],
    [["editMessage"], ["Edit the message"]],
  ] as const)("offers %j as %j", (remedies, buttons) => {
    render(
      <WorkspaceShell
        state={failed(remedies)}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      within(failureNotice())
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(buttons);
  });

  it("shows only the reason for a failure that offers nothing", () => {
    render(
      <WorkspaceShell
        state={failed()}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      within(failureNotice()).getByText(
        "The model connection stopped. Try again.",
      ),
    ).toBeVisible();
    expect(within(failureNotice()).queryAllByRole("button")).toEqual([]);
  });

  it("lands on the API key dialog", async () => {
    render(<Live initial={failed(["updateApiKey"])} commands={stubCommands} />);

    fireEvent.click(screen.getByRole("button", { name: "Update API key" }));

    expect(
      await screen.findByRole("dialog", { name: "OpenRouter API key" }),
    ).toBeVisible();
  });

  it("chooses another model on the model settings page, without opening the key dialog", async () => {
    render(
      <Live
        initial={failed(["chooseModel", "tryAgain"])}
        commands={stubCommands}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose a model" }));

    expect(
      await screen.findByRole("region", { name: "Model" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("tries again by sending the last message once, after taking the failed attempt back", async () => {
    const order: string[] = [];
    const commitRewind = vi.fn(async () => {
      order.push("rewound");
      return { files: [] };
    });
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {
      order.push("sent");
    });
    render(
      <WorkspaceShell
        state={failed(["tryAgain"])}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          previewRewind: async () => ({
            id: "rewind-1",
            taskId: "task-1",
            messageId: "message-1",
            draft: "Summarise the notes",
            discardedMessages: 1,
            laterUserMessages: 0,
            discardedActions: [],
            files: [],
          }),
          commitRewind,
          sendMessage,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(order).toEqual(["rewound", "sent"]));
    expect(commitRewind).toHaveBeenCalledWith("task-1", "rewind-1", "keep");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith("task-1", "Summarise the notes", {
      enabled: true,
      effort: "high",
    });
  });

  it("continues from completed work by asking the model to carry on", async () => {
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    const commitRewind = vi.fn(async () => ({ files: [] }));
    render(
      <WorkspaceShell
        state={failed(["continue", "tryAgain"])}
        dispatch={() => undefined}
        commands={{ ...stubCommands, sendMessage, commitRewind }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith("task-1", "Continue.", {
        enabled: true,
        effort: "high",
      }),
    );
    expect(commitRewind).not.toHaveBeenCalled();
  });

  it("opens OpenRouter's credits page", () => {
    const openExternalUrl = vi.fn(async () => {});
    render(
      <WorkspaceShell
        state={failed(["addCredits", "tryAgain"])}
        dispatch={() => undefined}
        commands={{ ...stubCommands, openExternalUrl }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add OpenRouter credits" }),
    );

    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://openrouter.ai/settings/credits",
    );
  });

  it("edits the message where it is", async () => {
    render(
      <WorkspaceShell
        state={failed(["editMessage"])}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          previewRewind: async () => ({
            id: "rewind-1",
            taskId: "task-1",
            messageId: "message-1",
            draft: "Summarise the notes",
            discardedMessages: 1,
            laterUserMessages: 0,
            discardedActions: [],
            files: [],
          }),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit the message" }));

    const field = screen.getByRole("textbox", { name: "Edit your message" });
    expect(field).toHaveValue("Summarise the notes");
    expect(field).toHaveFocus();
  });
});

describe("a turn's files", () => {
  /** Two turns; the first wrote a file, by itself and through a specialist. */
  function wrote() {
    return createWorkspaceState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Notes",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          workspace: { path: "C:/work", name: "work" },
          messages: [
            { id: "u1", role: "user", text: "Write the notes", sequence: 0 },
            { id: "a1", role: "assistant", text: "Written.", sequence: 3 },
            { id: "u2", role: "user", text: "Thanks", sequence: 4 },
            {
              id: "a2",
              role: "assistant",
              text: "You're welcome.",
              sequence: 5,
            },
          ],
          actions: [
            {
              id: "write-1",
              action: "Write notes",
              target: "notes.md",
              status: "completed",
              changes: [
                { path: "notes.md", change: "created", after: "notes\n" },
              ],
              sequence: 1,
            },
            {
              id: "write-2",
              action: "Write summary",
              target: "summary.md",
              status: "completed",
              specialistRunId: "run-1",
              changes: [
                { path: "summary.md", change: "created", after: "sum\n" },
              ],
              sequence: 2,
            },
          ],
          phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
        },
      ],
    });
  }

  it("are listed under the turn that changed them, specialists' included, and nowhere else", () => {
    render(
      <WorkspaceShell
        state={wrote()}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    const panels = screen.getAllByRole("region", { name: /files changed/ });
    expect(panels).toHaveLength(1);
    expect(
      within(panels[0]!).getByRole("heading", { name: "2 files changed" }),
    ).toBeVisible();
    expect(
      screen.getByText("Written.").compareDocumentPosition(panels[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      panels[0]!.compareDocumentPosition(screen.getByText("Thanks")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("leave no empty response under a turn that is still working", () => {
    const state = wrote();
    const task = state.tasks[0]!;
    render(
      <WorkspaceShell
        state={{
          ...state,
          tasks: [
            {
              ...task,
              messages: task.messages.slice(0, 1),
              actions: task.actions!.slice(0, 1),
              phase: { kind: "working", steps: [] },
            },
          ],
        }}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    // Each response has something in it beside Zhiyin's mark.
    const responses = screen.getAllByRole("article", {
      name: "Zhiyin response",
    });
    expect(
      responses.filter((response) => !response.textContent?.trim()),
    ).toEqual([]);
  });

  it("are said to be unlisted under a turn whose command's folder could not be checked", () => {
    const state = wrote();
    const task = state.tasks[0]!;
    render(
      <WorkspaceShell
        state={{
          ...state,
          tasks: [
            {
              ...task,
              actions: [
                {
                  id: "bash-1",
                  action: "Run a command",
                  target: "python convert.py",
                  status: "completed",
                  commandChanges: {
                    status: "unchecked",
                    reason: "Zhiyin could not list this folder's files.",
                  },
                  sequence: 1,
                },
              ],
            },
          ],
        }}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Changed files" }),
    ).toHaveTextContent(
      "Files changed by commands are not listed. Zhiyin could not list this folder's files.",
    );
  });

  it("are undone through the core, keeping the conversation", async () => {
    const previewUndo = vi.fn<CoreApi["previewUndo"]>(async () => ({
      id: "undo-1",
      taskId: "task-1",
      messageId: "u1",
      files: [
        { path: "notes.md", action: "remove", status: "recoverable" },
        { path: "summary.md", action: "remove", status: "recoverable" },
      ],
    }));
    const commitUndo = vi.fn<CoreApi["commitUndo"]>(async () => ({
      files: [],
    }));
    render(
      <WorkspaceShell
        state={wrote()}
        dispatch={() => undefined}
        commands={{ ...stubCommands, previewUndo, commitUndo }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo these changes" }));
    fireEvent.click(
      within(
        await screen.findByRole("dialog", { name: "Undo these changes" }),
      ).getByRole("button", { name: "Undo changes" }),
    );

    await waitFor(() =>
      expect(commitUndo).toHaveBeenCalledWith("task-1", "undo-1"),
    );
    expect(previewUndo).toHaveBeenCalledWith("task-1", "u1");
  });
});

describe("the app's settings", () => {
  it("open from the app menu, and turn notifications off through the core", async () => {
    const setNotifications = vi.fn<CoreApi["setNotifications"]>(
      async () => undefined,
    );
    render(
      <Live
        initial={createWorkspaceState({ connection: "ready" })}
        commands={{ ...stubCommands, setNotifications }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open app menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    fireEvent.click(
      within(screen.getByRole("region", { name: "Settings" })).getByRole(
        "switch",
        { name: "Notifications" },
      ),
    );

    await waitFor(() => expect(setNotifications).toHaveBeenCalledWith(false));
  });

  it("open a conversation from what it cost on the Usage page", async () => {
    const selectTask = vi.fn<CoreApi["selectTask"]>(async () => undefined);
    const range = (days: 7 | 30) => ({
      days,
      requests: 3,
      inputTokens: 30,
      outputTokens: 6,
      costUsd: 0.5,
      pricedRequests: 3,
      activity: [],
      models: [],
      conversations: [
        {
          conversationId: "task-2",
          requests: 3,
          pricedRequests: 3,
          costUsd: 0.5,
        },
      ],
    });
    render(
      <Live
        initial={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          tasks: [
            { ...failed().tasks[0]!, id: "task-1", title: "Today" },
            { ...failed().tasks[0]!, id: "task-2", title: "Survey tools" },
          ],
          usage: {
            status: "ready",
            costSource: "provider-reported",
            ranges: { "7": range(7), "30": range(30) },
          },
        })}
        commands={{ ...stubCommands, selectTask }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open app menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Usage" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Survey tools" }));

    await waitFor(() => expect(selectTask).toHaveBeenCalledWith("task-2"));
    expect(
      screen.queryByRole("region", { name: "Usage overview" }),
    ).not.toBeInTheDocument();
  });

  it("open the data folder through the core, and the menu has no evidence page", async () => {
    const openDataFolder = vi.fn<CoreApi["openDataFolder"]>(
      async () => undefined,
    );
    render(
      <Live
        initial={createWorkspaceState({ connection: "ready" })}
        commands={{ ...stubCommands, openDataFolder }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open app menu" }));
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Usage", "Model", "Custom instructions", "Settings"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Open data folder" }));

    await waitFor(() => expect(openDataFolder).toHaveBeenCalledOnce());
  });

  it("choose light or dark through the core, and show the choice saved", async () => {
    const setAppearance = vi.fn<CoreApi["setAppearance"]>(
      async () => undefined,
    );
    render(
      <Live
        initial={{
          ...createWorkspaceState({ connection: "ready" }),
          appearance: "dark",
          surface: "preferences",
        }}
        commands={{ ...stubCommands, setAppearance }}
      />,
    );

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Match Windows" }));

    await waitFor(() => expect(setAppearance).toHaveBeenCalledWith("system"));
  });

  it("turn spelling off through the core, keeping the languages it checks", async () => {
    const setSpelling = vi.fn<CoreApi["setSpelling"]>(async () => undefined);
    render(
      <Live
        initial={{
          ...createWorkspaceState({ connection: "ready" }),
          spelling: {
            enabled: true,
            languages: [
              { code: "en-GB", status: "ready" },
              { code: "fr", status: "ready" },
            ],
            offered: [
              {
                code: "en-GB",
                name: "British English",
                englishName: "British English",
              },
              { code: "fr", name: "Français", englishName: "French" },
            ],
          },
          surface: "preferences",
        }}
        commands={{ ...stubCommands, setSpelling }}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Check spelling" }));

    await waitFor(() =>
      expect(setSpelling).toHaveBeenCalledWith({
        enabled: false,
        languages: ["en-GB", "fr"],
      }),
    );
  });

  it("show notifications as off when the person turned them off", () => {
    render(
      <WorkspaceShell
        state={{
          ...createWorkspaceState({ connection: "ready" }),
          notifications: "off",
          surface: "preferences",
        }}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      screen.getByRole("switch", { name: "Notifications" }),
    ).toHaveAttribute("aria-checked", "false");
  });
});

describe("conversations another version saved", () => {
  const waiting = [
    {
      id: "trip",
      title: "Trip to Shanghai",
      titleSource: "manual" as const,
      updatedAt: "2026-10-01T09:00:00.000Z",
      updatedLabel: "Last week",
      needsUpdate: { writtenBy: "0.1.0-alpha.1" },
    },
  ];

  function shell(
    commands: CoreApi,
    state: Partial<WorkspaceState> = {},
  ): ReturnType<typeof render> {
    return render(
      <WorkspaceShell
        state={createWorkspaceState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          conversations: waiting,
          ...state,
        })}
        dispatch={() => undefined}
        commands={commands}
      />,
    );
  }

  it("asks at launch, and again from the list after Later", async () => {
    const settle = vi.fn(async () => ({ done: 1, failed: 0 }));
    shell({ ...stubCommands, settleSavedConversations: settle });

    const dialog = screen.getByRole("dialog", {
      name: "Update saved conversations",
    });
    expect(dialog).toHaveTextContent(
      "“Trip to Shanghai” was saved by an earlier version of Zhiyin (0.1.0-alpha.1).",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    // Listed as waiting, and its menu leads back to the question.
    const row = screen.getByRole("button", { name: /^Trip to Shanghai/ });
    expect(row).toHaveTextContent("To update");
    fireEvent.click(
      screen.getByRole("button", { name: "Options for Trip to Shanghai" }),
    );
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Update or delete…" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Update it" }));
    await waitFor(() => expect(settle).toHaveBeenCalledWith("update"));
  });

  it("asks again from the notice shown in place of a waiting conversation", () => {
    shell(stubCommands, {
      selectedTaskId: "trip",
      issues: [
        {
          message:
            "“Trip to Shanghai” was saved by Zhiyin 0.1.0-alpha.1 and needs an update before it opens.",
          conversationId: "trip",
          canUpdate: true,
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Update conversations…" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Update saved conversations" }),
    ).toBeVisible();
  });

  it("asks again from Settings", () => {
    shell(stubCommands, { surface: "preferences" });
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    fireEvent.click(screen.getByRole("button", { name: "Update or delete…" }));

    expect(
      screen.getByRole("dialog", { name: "Update saved conversations" }),
    ).toBeVisible();
  });

  it("shows the newer-history page in place of the workspace", () => {
    const open = vi.fn(async () => {});
    shell(
      { ...stubCommands, openExternalUrl: open },
      {
        conversations: [],
        runtime: { tasks: "unavailable", capabilities: "available" },
        newerHistory: { writtenBy: "0.2.0" },
      },
    );

    expect(
      screen.getByRole("heading", {
        name: "Your history needs a newer Zhiyin.",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("log", { name: "Task conversation" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Get the latest version" }),
    );
    expect(open).toHaveBeenCalledWith(
      "https://github.com/ZhiyinAgent/Zhiyin/releases",
    );
  });
});
