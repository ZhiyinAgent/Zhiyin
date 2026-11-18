import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyConversationLists, type CoreApi } from "@zhiyin/contract";
import {
  createWindowState,
  type WindowState,
  type WorkspaceTask,
} from "./windowState.js";
import { WindowShell } from "./WindowShell.js";
import { stubCommands } from "../../stubCommands.js";
import { Live, failed } from "./test/shell.js";

describe("what a turn shows", () => {
  it("places durable tool-result views in conversation order", () => {
    render(
      <WindowShell
        state={createWindowState({
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

  it("keeps the files a task produced in a panel of their own, addressed by task", async () => {
    const previewArtifact = vi.fn<CoreApi["previewArtifact"]>(async () => ({
      status: "ready" as const,
      path: "reports/brief.md",
      text: "The finished brief.",
      truncated: false,
    }));
    render(
      <WindowShell
        state={createWindowState({
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
          resolveApproval: async () => {},
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

  it("shows another conversation's files without the last one's preview", async () => {
    const conversation = (id: string, title: string): WorkspaceTask => ({
      id,
      title,
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [{ sequence: 0, id: `m-${id}`, role: "user", text: title }],
      artifacts: [
        {
          path: "report.md",
          name: "report.md",
          change: "created",
          bytes: 19,
          updatedAt: "2026-09-05T10:00:00.000Z",
        },
      ],
      phase: {
        kind: "completed",
        outcome: { title: "Done", summary: "The report is ready." },
      },
    });
    const showing = (selectedTaskId: string) => (
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId,
          tasks: [
            conversation("task-1", "Write the brief"),
            conversation("task-2", "Write the memo"),
          ],
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          previewArtifact: async (taskId) => ({
            status: "ready",
            path: "report.md",
            text: `The report of ${taskId}.`,
            truncated: false,
          }),
        }}
      />
    );
    const { rerender } = render(showing("task-1"));
    fireEvent.click(screen.getByRole("button", { name: /^Files/ }));
    fireEvent.click(screen.getByRole("button", { name: /report\.md/ }));
    expect(await screen.findByText("The report of task-1.")).toBeVisible();

    rerender(showing("task-2"));

    expect(screen.queryByText("The report of task-1.")).toBeNull();
    expect(screen.getByRole("button", { name: /report\.md/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  /**
   * A snapshot carries which conversation is open. Unless the core is told one
   * was left for a new one, the next snapshot to arrive (after choosing a
   * folder, say) puts the old one back.
   */

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
    const state = createWindowState({
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
      <WindowShell
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
      createWindowState({
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
      <WindowShell
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
      <WindowShell
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
    const state = createWindowState({
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
      <WindowShell
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
      createWindowState({
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
      <WindowShell
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
      <WindowShell
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
      <WindowShell
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
    const state = createWindowState({
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
      <WindowShell
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

  it("draws a specialist's report as the Markdown it wrote it in", () => {
    const state = createWindowState({
      connection: "ready",
      selectedTaskId: "task",
      tasks: [
        {
          id: "task",
          title: "Review the plan",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            { sequence: 0, id: "user", role: "user", text: "Review the plan" },
          ],
          specialistRuns: [
            {
              sequence: 1,
              id: "run-1",
              specialist: {
                id: "reviewer",
                name: "Reviewer",
                description: "Reviewer.",
                instructions: "Check.",
                provenance: { source: "plugin", pluginId: "engineering" },
              },
              task: "Review the plan.",
              depth: 1,
              status: "completed",
              startedAt: "2026-10-05T09:00:00.000Z",
              finishedAt: "2026-10-05T09:01:00.000Z",
              actionIds: [],
              handoff: {
                report: [
                  "Two problems.",
                  "",
                  "## Findings",
                  "",
                  "- **MAJOR (§11)**: the plan contradicts the required cadence.",
                  "- A finding with no lead, only a sentence.",
                  "",
                  "## What I could not check",
                  "",
                  "The installed build.",
                ].join("\n"),
              },
            },
          ],
          phase: {
            kind: "completed",
            outcome: { title: "Done", summary: "Done." },
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

    fireEvent.click(
      screen.getByRole("button", { name: "Inspect Reviewer specialist" }),
    );
    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Findings" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: "What I could not check" }),
    ).toBeInTheDocument();
    const lead = within(dialog).getByText("MAJOR (§11)");
    expect(lead.tagName).toBe("STRONG");
    expect(lead.closest("li")).toHaveTextContent(
      "MAJOR (§11): the plan contradicts the required cadence.",
    );
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
  });
});

function failureNotice() {
  return screen
    .getByText("Task stopped with an error")
    .closest<HTMLElement>("[role=status]")!;
}

describe("a failed turn", () => {
  it.each([
    // No key is saved in this window, so the key is added.
    [["updateApiKey"], ["Add API key"]],
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
      <WindowShell
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
      <WindowShell
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

    fireEvent.click(screen.getByRole("button", { name: "Add API key" }));

    expect(
      await screen.findByRole("dialog", { name: "OpenRouter API key" }),
    ).toBeVisible();
  });

  it("offers to update the key, rather than add one, once a key is saved", () => {
    const state = failed(["updateApiKey"]);
    render(
      <WindowShell
        state={{
          ...state,
          provider: {
            ...state.provider,
            credential: { status: "configured", source: "credentialStore" },
          },
        }}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      within(failureNotice()).getByRole("button", { name: "Update API key" }),
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
      <WindowShell
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
      <WindowShell
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
      <WindowShell
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

  it("sends a person to the billing of the provider requests go to", () => {
    const openExternalUrl = vi.fn(async () => {});
    render(
      <WindowShell
        state={{
          ...failed(["addCredits", "tryAgain"]),
          provider: {
            provider: {
              id: "deepseek",
              name: "DeepSeek",
              pages: {
                keys: "https://platform.deepseek.com/api_keys",
                billing: "https://platform.deepseek.com/",
              },
            },
            endpoint: "https://api.deepseek.com/chat/completions",
            credential: { status: "configured", source: "credentialStore" },
          },
        }}
        dispatch={() => undefined}
        commands={{ ...stubCommands, openExternalUrl }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add DeepSeek credits" }),
    );

    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://platform.deepseek.com/",
    );
  });

  describe("says why a page or a pasted text did not open", () => {
    const deepSeek: WindowState["provider"] = {
      provider: {
        id: "deepseek",
        name: "DeepSeek",
        pages: {
          keys: "https://platform.deepseek.com/api_keys",
          billing: "https://platform.deepseek.com/",
        },
      },
      endpoint: "https://api.deepseek.com/chat/completions",
      credential: { status: "configured", source: "credentialStore" },
    };
    const refusing = {
      ...stubCommands,
      openExternalUrl: () =>
        Promise.reject(new Error("The page could not be opened.")),
      openAttachment: () =>
        Promise.reject(new Error("The pasted text is no longer kept.")),
    };

    it("from a turn's remedy", async () => {
      render(
        <Live
          initial={{
            ...failed(["addCredits", "tryAgain"]),
            provider: deepSeek,
          }}
          commands={refusing}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Add DeepSeek credits" }),
      );

      expect(
        await screen.findByText("The page could not be opened."),
      ).toBeVisible();
    });

    it("from Settings", async () => {
      render(
        <Live
          initial={{
            ...createWindowState({
              connection: "ready",
              runtime: { tasks: "available", capabilities: "available" },
            }),
            surface: "model",
            provider: deepSeek,
          }}
          commands={refusing}
        />,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Billing" }));

      expect(
        await screen.findByText("The page could not be opened."),
      ).toBeVisible();
    });

    it("from the conversation", async () => {
      const paste = {
        kind: "pastedText" as const,
        id: "pasted-2026-09-24-101500.txt",
        bytes: 48_000,
        lines: 1_200,
      };
      render(
        <Live
          initial={createWindowState({
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
                    sequence: 0,
                    id: "u",
                    role: "user",
                    text: "",
                    attachments: [paste],
                  },
                ],
                phase: {
                  kind: "completed",
                  outcome: { title: "Done", summary: "Read." },
                },
              },
            ],
          })}
          commands={refusing}
        />,
      );

      fireEvent.click(
        within(
          screen.getByRole("log", { name: "Task conversation" }),
        ).getByRole("button", { name: /Open pasted text/ }),
      );

      expect(
        await screen.findByText("The pasted text is no longer kept."),
      ).toBeVisible();
    });
  });

  it("edits the message where it is", async () => {
    render(
      <WindowShell
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
    return createWindowState({
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
      <WindowShell
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

  it("are joined, under the answer, by the last verdict of the checks a tool measured in the turn", () => {
    const state = wrote();
    const task = state.tasks[0]!;
    const build = (id: string, holds: boolean, sequence: number) => ({
      id,
      action: "Build the CAD script",
      target: "stand.py",
      status: "completed" as const,
      details: [
        {
          kind: "checks" as const,
          label: "Requirements in requirements.json",
          items: [{ label: "R1", holds, note: "measured" }],
        },
      ],
      sequence,
    });
    render(
      <WindowShell
        state={{
          ...state,
          tasks: [
            {
              ...task,
              actions: [
                ...task.actions!,
                build("build-1", false, 1),
                build("build-2", true, 2),
              ],
            },
          ],
        }}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    const card = screen.getByRole("region", {
      name: "Requirements in requirements.json: 1 of 1 checked holds",
    });
    expect(within(card).getByRole("listitem")).toHaveTextContent(
      "HoldsR1measured",
    );
    expect(
      screen.getByText("Written.").compareDocumentPosition(card) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      card.compareDocumentPosition(screen.getByText("Thanks")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("leave no empty response under a turn that is still working", () => {
    const state = wrote();
    const task = state.tasks[0]!;
    render(
      <WindowShell
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
      <WindowShell
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
      <WindowShell
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
