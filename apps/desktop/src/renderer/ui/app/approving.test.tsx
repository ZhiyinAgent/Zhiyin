import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyConversationLists, type CoreApi } from "@zhiyin/contract";
import { createWindowState, type WorkspaceTask } from "./windowState.js";
import { WindowShell } from "./WindowShell.js";
import { Dialog } from "../shared/index.js";
import { stubCommands } from "../../stubCommands.js";

describe("approving and answering", () => {
  it.each(["Allow once", "Deny"])(
    "keeps one approval accessible in either workspace view: %s",
    async (decision) => {
      const resolveApproval = vi.fn().mockResolvedValue(undefined);
      const state = createWindowState({
        connection: "ready",
        selectedTaskId: "preview-task",
        beside: {
          "preview-task": {
            browser: {
              status: "open",
              url: "https://example.com",
              title: "Preview",
              loading: false,
            },
            view: "browser",
          },
        },
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
        <WindowShell
          state={state}
          dispatch={() => undefined}
          commands={{ ...stubCommands, resolveApproval }}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: "Browser" }));
      expect(
        screen.getAllByRole("region", { name: "Permission request" }),
      ).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Show details" })).toBeNull();
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

  describe("an approval that arrives during a turn", () => {
    const working: WorkspaceTask = {
      id: "save",
      title: "Summary",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [],
      phase: { kind: "working", steps: [] },
    };
    const asking: WorkspaceTask = {
      ...working,
      phase: {
        kind: "approval",
        steps: [],
        prompt: {
          id: "write",
          action: "Save the summary",
          reason: "Write summary.md in the workspace.",
          target: "summary.md",
          command: "write_file(…)",
        },
      },
    };
    const shell = (task: WorkspaceTask) => (
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "save",
          tasks: [task],
        })}
        dispatch={() => undefined}
        commands={stubCommands}
      />
    );

    it("takes focus when nothing is being written, so the keyboard answers it", () => {
      const { rerender } = render(shell(working));
      screen.getByLabelText("Message Zhiyin").focus();

      rerender(shell(asking));

      expect(
        screen.getByRole("heading", { name: "Save the summary" }),
      ).toHaveFocus();
    });

    it("leaves focus with a message being written, and says it is waiting", () => {
      const { rerender } = render(shell(working));
      const composer = screen.getByLabelText("Message Zhiyin");
      composer.focus();
      fireEvent.change(composer, { target: { value: "Also add a chart" } });

      rerender(shell(asking));

      expect(composer).toHaveFocus();
      expect(
        screen.getByText("Permission needed: Save the summary"),
      ).toBeInTheDocument();
      expect(
        screen
          .getByText("Permission needed: Save the summary")
          .closest("[aria-live]"),
      ).toBeInTheDocument();
    });

    it("leaves focus in a dialog that is open", () => {
      const withDialog = (task: WorkspaceTask) => (
        <>
          {shell(task)}
          <Dialog title="Rename the conversation" onClose={() => undefined}>
            <button type="button">Keep the name</button>
          </Dialog>
        </>
      );
      const { rerender } = render(withDialog(working));
      const inDialog = screen.getByRole("button", { name: "Keep the name" });
      inDialog.focus();

      rerender(withDialog(asking));

      expect(inDialog).toHaveFocus();
    });
  });

  it("shows an approval's reason the AI wrote as Zhiyin's account", () => {
    const state = createWindowState({
      connection: "ready",
      selectedTaskId: "save",
      tasks: [
        {
          id: "save",
          title: "Summary",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [],
          phase: {
            kind: "approval",
            steps: [],
            prompt: {
              id: "write",
              action: "Save the summary",
              reason: "Save the summary the person asked for.",
              reasonByModel: true,
              target: "summary.md",
              command: "write_file(…)",
            },
          },
        },
      ],
    });
    render(
      <WindowShell
        state={state}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      screen.getByText("Save the summary the person asked for."),
    ).toHaveTextContent(/^The AI says/);
  });

  it("keeps the explanation in the turn and the decision beside the composer", () => {
    const state = createWindowState({
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
      <WindowShell
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

  it("returns the exact approval decision to the core", () => {
    const resolveApproval = vi.fn<CoreApi["resolveApproval"]>(async () => {});
    const state = createWindowState({
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
      <WindowShell
        state={state}
        dispatch={() => undefined}
        commands={{
          createTask: async () => "task-1",
          selectTask: async () => {},
          openTask: async () => {},
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
          changeMemory: async () => ({ ok: true }),
          setConversationMemory: async () => {},
          condenseNow: async () => {},
          interruptTask: async () => {},
          answerNow: async () => false,
          sendNow: async () => false,
          takeBackMessage: async () => {},
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
          cancelToolchainInstall: async () => {},
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
          openAnswerLink: async () => {},
          driveBrowser: async () => {},
          watchBrowser: async () => {},
          lookAtScene: async () => {},
          partModel: async () => undefined,
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
          listProviders: async () => [],
          listModels: async () => ({ status: "ready", models: [] }),
          listModelProviders: async () => ({
            status: "unavailable",
            reason: "not in this test",
          }),
          selectModel: async () => {},
          modelList: stubCommands.modelList,
          checkModelList: stubCommands.checkModelList,
          setModelListUpdates: stubCommands.setModelListUpdates,
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
    const state = createWindowState({
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
      <WindowShell
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
    const state = createWindowState({
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
      <WindowShell
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
    const state = createWindowState({
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
      <WindowShell
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
});
