import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  type UserInputResponse,
  type MessageAttachment,
  type ReasoningSelection,
} from "@zhiyin/contract";
import { AppSidebar } from "./AppSidebar.js";
import { ArtifactDrawer } from "../artifacts/index.js";
import {
  ConversationTimeline,
  NewConversation,
  OpenCitation,
  PlanPill,
} from "../conversation/index.js";
import { ComposerDock } from "./ComposerDock.js";
import { ConversationHeader } from "./ConversationHeader.js";
import { drawn, Icon, keyboardStops } from "../shared/index.js";
import { IssueNotices } from "./IssueNotices.js";
import { useConversationDeletion } from "./useConversationDeletion.js";
import { useAppShortcuts } from "./useAppShortcuts.js";
import { useContextBudget } from "./useContextBudget.js";
import { timelinePieces, timelineTask } from "./timelinePieces.js";
import { WorkspaceSurfaces } from "./WorkspaceSurfaces.js";
import type { WorkspaceCommands } from "./workspaceCommands.js";
import {
  guidanceDraft,
  sendComposerMessage,
  taskIsRunning,
} from "./dockState.js";
import { WorkspaceNotice } from "../workspace/index.js";
import { ConversationWorkspace } from "./ConversationWorkspace.js";
import { useWorkspaceView } from "./useWorkspaceView.js";
import { useFollowedConversation } from "./useFollowedConversation.js";
import { useConversationSettle } from "./useConversationSettle.js";
import { windowGate } from "./windowGate.js";
import { RestartNotice } from "./RestartNotice.js";
import { useConversationExport } from "./useConversationExport.js";
import { useConversationPermissions } from "./useConversationPermissions.js";
import { useSavedConversationsUpdate } from "./useSavedConversationsUpdate.js";
import { UserInputPrompt } from "../user-input/index.js";
import type {
  WorkspaceAction,
  WorkspaceState,
  WorkspaceTask,
} from "./workspaceState.js";
import { listedConversations } from "./workspaceState.js";
import styles from "./app.module.css";

/** Says in the conversation what is open beside it, and offers to show it. */
function BesideNotice({
  beside,
  onShow,
}: {
  beside: NonNullable<ReturnType<typeof useWorkspaceView>["beside"]>;
  onShow: () => void;
}) {
  return (
    <WorkspaceNotice
      {...(beside.kind === "browser"
        ? { text: "Zhiyin opened a browser." }
        : beside.kind === "scene"
          ? {
              text: `${beside.scene.file?.split("/").pop() ?? "A 3D scene"} is open in the 3D view.`,
              icon: "cube" as const,
            }
          : {
              text: `${beside.document.name} is open in the workspace.`,
              icon: "file" as const,
            })}
      onShow={onShow}
    />
  );
}

type WorkspaceShellProps = {
  state: WorkspaceState;
  /** The window came back after its page crashed, and has not said so yet. */
  restarted?: boolean;
  /** The notice was dismissed, or the person went to another page. */
  onRestartNoticed?: () => void;
  dispatch: (action: WorkspaceAction) => void;
  commands: WorkspaceCommands;
};

export function WorkspaceShell({
  state,
  dispatch,
  commands,
  restarted = false,
  onRestartNoticed,
}: WorkspaceShellProps) {
  // A restart is said on the page it happened on; another page ends it, so
  // coming back does not say it twice.
  useEffect(() => {
    if (restarted && state.surface !== "thread") onRestartNoticed?.();
  }, [restarted, state.surface, onRestartNoticed]);
  // Held with the rest of the window's state rather than beside it, so a
  // command's failure survives the pages of the app changing under it.
  const commandError = state.commandError ?? "";
  const setCommandError = (message: string) =>
    dispatch({ type: "commandErrorShown", message });
  const [toast, deleteConversation] = useConversationDeletion(
    state,
    commands.deleteTask,
    act,
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const permissions = useConversationPermissions(
    state.tasks,
    state.selectedTaskId,
    commands.revokeConversationPermission,
    (id) => act(() => commands.openTask(id)),
  );
  const exporting = useConversationExport(
    listedConversations(state),
    (id, format) =>
      commands.exportConversation?.(id, format) ??
      Promise.resolve({ status: "cancelled" }),
    commands.showInFolder
      ? (path) => void act(() => commands.showInFolder?.(path))
      : undefined,
  );
  const workspaceViewId = useId();
  // What is beside the conversation is the core's to decide (ADR 0023): it
  // opens the space the first time the agent uses a browser or writes a
  // document, and keeps a choice the person makes until the turn ends.
  const viewing = useWorkspaceView(state, commands, act);
  const besideOpen = viewing.open;
  const [composerDraft, setComposerDraft] = useState<{
    readonly id: string;
    readonly taskId: string;
    readonly text: string;
    readonly attachments?: readonly MessageAttachment[];
  }>();
  const [keyFirst, setKeyFirst] = useState(false);
  // Which empty composer is showing, counted up each time a new conversation
  // is started, so each starts empty.
  const [blank, setBlank] = useState(0);
  // The conversation the empty composer's own first message is opening. The
  // core shows it before the message is sent, and the composer stays the same
  // one there, so a send that fails leaves the words where they were typed.
  const [opening, setOpening] = useState<{
    readonly blank: number;
    readonly taskId?: string;
  }>();
  // The person's message open for editing where it is, as taskId:messageId.
  const [editingMessage, setEditingMessage] = useState<string>();
  const conversationRef = useRef<HTMLDivElement>(null);
  const selectedTask =
    state.tasks.find((task) => task.id === state.selectedTaskId) ?? null;
  const returnedGuidance = guidanceDraft(selectedTask);
  const budget = useContextBudget(state, selectedTask, commands, () =>
    openNavigationSurface("instructions"),
  );
  // Selected but not open: a conversation that could not be read, shown as
  // its report in its place.
  const unopened = state.selectedTaskId !== null && !selectedTask;
  const issues = state.issues ?? [];
  const concernsOpen = (issue: { conversationId?: string }) =>
    issue.conversationId === state.selectedTaskId;
  // Reports stay in view above the conversation, however far it is scrolled;
  // the unopened conversation's own report takes the conversation's place.
  const pinnedIssues = issues.filter(
    (issue) => !issue.conversationId || (concernsOpen(issue) && !unopened),
  );
  const ownIssues = unopened ? issues.filter(concernsOpen) : [];
  const notices = (list: typeof issues) => (
    <IssueNotices
      issues={list}
      openConversationId={state.selectedTaskId}
      retry={
        commands.frontendReady && state.runtime.tasks === "unavailable"
          ? () => void act(() => commands.frontendReady?.())
          : undefined
      }
      onDelete={deleteConversation}
      {...(savedUpdate.ask ? { onUpdate: savedUpdate.ask } : {})}
      onShowKept={(path) => void act(() => commands.showInFolder?.(path))}
      onDismiss={(message, conversationId) =>
        void act(() => commands.dismissIssue?.(message, conversationId))
      }
    />
  );
  const isRunning = taskIsRunning(selectedTask);
  useFollowedConversation(conversationRef, {
    conversationId: state.selectedTaskId,
    task: selectedTask,
    compact: besideOpen,
  });
  useConversationSettle(conversationRef, state.selectedTaskId);

  // The workspace is not always what the window is showing: onboarding and a
  // recovery decision are answered before anything else.
  const gate = windowGate(state, commands);
  const workspaceShowing = gate === undefined;
  const savedUpdate = useSavedConversationsUpdate(
    state,
    commands.settleSavedConversations,
    workspaceShowing,
  );
  useAppShortcuts(workspaceShowing, {
    newTask: () => startNewTask(),
    openSettings: () => openNavigationSurface("settings"),
  });

  const pieces = (task: WorkspaceTask) =>
    timelinePieces(
      task,
      commands,
      {
        editing: editingMessage,
        setEditing: setEditingMessage,
        say: setCommandError,
        restoreDraft: setComposerDraft,
        openSettings: (opening) => {
          openNavigationSurface("settings");
          setKeyFirst(opening === "apiKey");
        },
        ...(state.provider.provider
          ? { provider: state.provider.provider }
          : {}),
      },
      () => permissions.open(task.id),
    );

  if (gate) return gate;

  async function act(operation: () => void | Promise<unknown>) {
    setCommandError("");
    try {
      await operation();
    } catch (error) {
      setCommandError(
        error instanceof Error
          ? error.message
          : "That action could not be completed. Try again.",
      );
    }
  }

  async function submitMessage(
    message: string,
    reasoning?: ReasoningSelection,
    attachments?: readonly MessageAttachment[],
  ) {
    let taskId = selectedTask?.id;
    const opened = !taskId;
    if (!taskId) {
      setOpening({ blank });
      try {
        taskId = await commands.createTask();
      } catch (error) {
        setOpening(undefined);
        throw error;
      }
      setOpening({ blank, taskId });
      await budget.adopt(taskId);
    }
    setComposerDraft(undefined);
    await sendComposerMessage(commands.sendMessage, {
      taskId,
      message,
      reasoning,
      attachments,
      running: isRunning,
    });
    // The empty composer is the new conversation's now; the next empty one,
    // shown once nothing is open, starts empty.
    if (opened) setBlank((count) => (count === blank ? count + 1 : count));
  }

  function openSurface(surface: WorkspaceState["surface"]) {
    setKeyFirst(false);
    dispatch({ type: "surfaceOpened", surface });
  }

  function openNavigationSurface(surface: WorkspaceState["surface"]) {
    setNavigationOpen(false);
    openSurface(surface);
  }

  function startNewTask() {
    setNavigationOpen(false);
    dispatch({ type: "newTaskStarted" });
    setOpening(undefined);
    setBlank((count) => count + 1);
    // The core is told too. Every snapshot it sends says which conversation is
    // open, so leaving it believing the last one still is means the next
    // snapshot — choosing a folder, for instance — puts that conversation back
    // on screen.
    if (commands.selectNothing) void act(() => commands.selectNothing?.());
  }

  function stopTask() {
    if (!selectedTask) return;
    void act(() => commands.interruptTask(selectedTask.id));
  }

  function submitUserInput(response: UserInputResponse): Promise<void> {
    const task = selectedTask;
    if (!task || task.phase.kind !== "input")
      return Promise.reject(new Error("That question is no longer active."));
    return commands.resolveUserInput(task.id, task.phase.prompt.id, response);
  }

  return (
    <div
      className={`${styles["app-shell"]}${navigationOpen ? ` ${styles["app-shell--navigation-open"]}` : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && navigationOpen) {
          setNavigationOpen(false);
          navigationToggle.current?.focus();
        }
        if (event.key === "Tab" && navigationOpen)
          keepInDrawer(event, navigationToggle.current);
      }}
    >
      <button
        type="button"
        ref={navigationToggle}
        className={styles["mobile-navigation"]}
        aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={navigationOpen}
        onClick={() => setNavigationOpen((value) => !value)}
      >
        <Icon name={navigationOpen ? "x" : "menu"} />
      </button>
      <AppSidebar
        onOpenLibrary={() => openNavigationSurface("library")}
        tasks={listedConversations(state).map((item) => ({
          id: item.id,
          title: item.title,
          ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
          meta: item.updatedLabel,
          ...(item.needsUpdate ? { needsUpdate: true } : {}),
        }))}
        {...(savedUpdate.ask
          ? {
              onUpdateConversations: () => {
                setNavigationOpen(false);
                savedUpdate.ask?.();
              },
            }
          : {})}
        selectedId={state.selectedTaskId ?? ""}
        onSelect={(id) => {
          setNavigationOpen(false);
          void act(() => commands.selectTask(id));
        }}
        onNewTask={startNewTask}
        onRenameTask={(id, title) => act(() => commands.renameTask(id, title))}
        onDeleteTask={deleteConversation}
        onTaskPermissions={(id) => {
          setNavigationOpen(false);
          permissions.open(id);
        }}
        {...(commands.exportConversation
          ? {
              onExportConversation: (id) => {
                setNavigationOpen(false);
                exporting.open(id);
              },
            }
          : {})}
        onOpenUsage={() => openNavigationSurface("usage")}
        onOpenSettings={() => openNavigationSurface("settings")}
        onOpenInstructions={() => openNavigationSurface("instructions")}
        onOpenPreferences={() => openNavigationSurface("preferences")}
      />

      <WorkspaceSurfaces
        state={state}
        commands={{
          ...commands,
          // Pages and conversations open from many places on them; a failure
          // is said here.
          openExternalUrl: (url) => act(() => commands.openExternalUrl(url)),
          selectTask: (id) => act(() => commands.selectTask(id)),
        }}
        onOpenSurface={openSurface}
        openKeyDialog={keyFirst}
        {...(savedUpdate.ask ? { onUpdateConversations: savedUpdate.ask } : {})}
      />
      {commandError && (
        <div className={styles["command-error"]} role="alert">
          {commandError}
          <button
            aria-label="Dismiss error"
            onClick={() => setCommandError("")}
          >
            <Icon name="x" />
          </button>
        </div>
      )}

      {state.surface === "thread" && (
        <>
          <section className={styles["session-pane"]}>
            <ConversationHeader
              state={state}
              task={selectedTask}
              commands={commands}
              dispatch={dispatch}
              viewing={viewing}
              viewId={workspaceViewId}
              files={{
                open: filesOpen,
                onToggle: () => setFilesOpen((shown) => !shown),
              }}
            />
            <main
              className={`${styles["thread-view"]}${
                selectedTask?.phase.kind === "approval" ||
                selectedTask?.phase.kind === "input"
                  ? ` ${styles["thread-view--approval"]}`
                  : ""
              }`}
            >
              <ConversationWorkspace
                viewing={viewing}
                taskId={state.selectedTaskId}
                agentWorking={selectedTask?.phase.kind === "working"}
                id={workspaceViewId}
                commands={commands}
                act={act}
              >
                <div
                  className={styles["conversation-landscape"]}
                  aria-hidden="true"
                />
                <div className={styles["workspace-view"]}>
                  {restarted && (
                    // Over the conversation column, whatever is beside it.
                    <div className={styles["restart-anchor"]}>
                      <RestartNotice onDismiss={() => onRestartNoticed?.()} />
                    </div>
                  )}
                  <PlanPill
                    key={selectedTask?.id}
                    items={selectedTask?.plan ?? []}
                  />
                  {pinnedIssues.length > 0 && (
                    <div className={styles["issue-stack"]}>
                      {notices(pinnedIssues)}
                    </div>
                  )}
                  <div
                    className={`${styles["thread-scroll"]}${selectedTask ? "" : ` ${styles["thread-scroll--new"]}`}${besideOpen ? ` ${styles["thread-scroll--compact"]}` : ""}`}
                    ref={conversationRef}
                    role="log"
                    aria-label="Task conversation"
                    aria-busy={isRunning}
                  >
                    {unopened && notices(ownIssues)}
                    {!selectedTask && !unopened && (
                      <NewConversation
                        onSuggestion={(value) =>
                          void act(() => submitMessage(value))
                        }
                        disabled={state.runtime.tasks === "unavailable"}
                      />
                    )}
                    {selectedTask &&
                      selectedTask.phase.kind === "draft" &&
                      selectedTask.messages.length === 0 && (
                        <NewConversation
                          onSuggestion={(value) =>
                            void act(() => submitMessage(value))
                          }
                          disabled={state.runtime.tasks === "unavailable"}
                        />
                      )}
                    {selectedTask && selectedTask.messages.length > 0 && (
                      <OpenCitation.Provider value={viewing.cite}>
                        <ConversationTimeline
                          task={timelineTask(
                            selectedTask,
                            state.compacting.find(
                              (item) => item.taskId === selectedTask.id,
                            )?.since,
                          )}
                          pieces={pieces(selectedTask)}
                          compact={besideOpen}
                        />
                      </OpenCitation.Provider>
                    )}
                    {selectedTask?.phase.kind === "input" &&
                      selectedTask.phase.prompt.kind === "quiz" && (
                        <UserInputPrompt
                          prompt={selectedTask.phase.prompt}
                          onSubmit={submitUserInput}
                          onCancel={stopTask}
                        />
                      )}
                    {viewing.beside && !besideOpen && (
                      <BesideNotice
                        beside={viewing.beside}
                        onShow={viewing.toWorkspace}
                      />
                    )}
                  </div>
                </div>
                {selectedTask && (
                  <ArtifactDrawer
                    conversationId={selectedTask.id}
                    folder={selectedTask.workspace?.path}
                    artifacts={selectedTask.artifacts}
                    open={filesOpen}
                    onClose={() => setFilesOpen(false)}
                    onPreview={(path) =>
                      commands.previewArtifact(selectedTask.id, path)
                    }
                    onExport={(path) =>
                      commands.exportArtifact(selectedTask.id, path)
                    }
                    onShowBeside={(path) => {
                      setFilesOpen(false);
                      void act(async () => {
                        const outcome = await commands.showDocument(
                          selectedTask.id,
                          path,
                        );
                        if (!outcome.ok) throw new Error(outcome.reason);
                      });
                    }}
                  />
                )}
                <ComposerDock
                  composerKey={
                    !selectedTask
                      ? `new:${blank}`
                      : opening &&
                          (opening.taskId ?? selectedTask.id) ===
                            selectedTask.id
                        ? `new:${opening.blank}`
                        : selectedTask.id
                  }
                  state={state}
                  task={selectedTask}
                  commands={commands}
                  act={act}
                  compact={besideOpen}
                  hidden={unopened}
                  draft={
                    composerDraft && composerDraft.taskId === selectedTask?.id
                      ? composerDraft
                      : returnedGuidance
                  }
                  context={budget.context}
                  onSubmit={submitMessage}
                  onStop={stopTask}
                  onUserInput={submitUserInput}
                  onReturnToConversation={viewing.toConversation}
                />
              </ConversationWorkspace>
            </main>
          </section>
        </>
      )}
      {permissions.panel}
      {exporting.panel}
      {savedUpdate.panel}
      {toast}
    </div>
  );
}

/**
 * While the navigation drawer covers the window, Tab and Shift+Tab go round
 * its button and the drawer, as in a dialog. Where the window is wide enough
 * the drawer is the sidebar and the button is not drawn, so nothing is kept.
 */
function keepInDrawer(
  event: KeyboardEvent<HTMLElement>,
  toggle: HTMLButtonElement | null,
) {
  const drawer = event.currentTarget.querySelector(
    'aside[aria-label="Primary navigation"]',
  );
  if (!toggle || !drawer || !drawn(toggle)) return;
  const stops = [toggle, ...keyboardStops(drawer)];
  const at = stops.indexOf(document.activeElement as HTMLElement);
  const next = event.shiftKey
    ? at <= 0
      ? stops.at(-1)
      : undefined
    : at === -1 || at === stops.length - 1
      ? stops[0]
      : undefined;
  if (!next) return;
  event.preventDefault();
  next.focus();
}
