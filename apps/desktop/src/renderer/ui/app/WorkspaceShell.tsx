import { useEffect, useId, useRef, useState } from "react";
import { Onboarding } from "../onboarding/index.js";
import { HistoryRecoveryGate, NewerHistoryGate } from "../recovery/index.js";
import {
  RELEASES_URL,
  type UserInputResponse,
  type MessageAttachment,
  type ReasoningSelection,
} from "@zhiyin/contract";
import { ApprovalPrompt } from "../actions/index.js";
import { WorkspacePicker } from "./WorkspacePicker.js";
import { AppSidebar } from "./AppSidebar.js";
import { ArtifactDrawer } from "../artifacts/index.js";
import {
  Composer,
  ConversationTimeline,
  NewConversation,
  OpenCitation,
  PlanPill,
  useReadingPosition,
} from "../conversation/index.js";
import { Icon } from "../shared/index.js";
import { IssueNotices } from "./IssueNotices.js";
import { useConversationDeletion } from "./useConversationDeletion.js";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton.js";
import { useAppShortcuts } from "./useAppShortcuts.js";
import { useContextBudget } from "./useContextBudget.js";
import { timelinePieces, timelineTask } from "./timelinePieces.js";
import { WorkspaceSurfaces } from "./WorkspaceSurfaces.js";
import type { WorkspaceCommands } from "./workspaceCommands.js";
import {
  approvalPromptDetails,
  composerLock,
  guidanceDraft,
  sendComposerMessage,
  taskIsRunning,
} from "./dockState.js";
import { WorkspaceNotice } from "../workspace/index.js";
import { ConversationWorkspace } from "./ConversationWorkspace.js";
import { useWorkspaceView } from "./useWorkspaceView.js";
import { RestartNotice } from "./RestartNotice.js";
import { SessionHeader } from "./SessionHeader.js";
import { RunningCommands } from "../commands/index.js";
import { WorkspaceViewTabs } from "./WorkspaceViewTabs.js";
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
  const [filesOpen, setFilesOpen] = useState(false);
  const permissions = useConversationPermissions(
    state.tasks,
    commands.revokeConversationPermission,
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
  // What is beside the conversation is the core's to decide (ADR 0018): it
  // opens the space the first time the agent uses a browser or writes a
  // document, and keeps a choice the person makes until the turn ends.
  const viewing = useWorkspaceView(state, commands, act);
  const besideOpen = viewing.open;
  const hasWorkspace = viewing.beside !== undefined;
  const [composerDraft, setComposerDraft] = useState<{
    readonly id: string;
    readonly taskId: string;
    readonly text: string;
    readonly attachments?: readonly MessageAttachment[];
  }>();
  const [keyFirst, setKeyFirst] = useState(false);
  // The person's message open for editing where it is, as taskId:messageId.
  const [editingMessage, setEditingMessage] = useState<string>();
  const conversationRef = useRef<HTMLDivElement>(null);
  // Opening or closing the browser resizes this column, which rewraps every
  // message. Where someone was reading survives that; a scroll offset in
  // pixels would not. It is also the one place that follows the end.
  const reading = useReadingPosition(conversationRef);
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
      onDismiss={(message) => void act(() => commands.dismissIssue?.(message))}
    />
  );
  const isRunning = taskIsRunning(selectedTask);
  const folderLocked = isRunning || state.runtime.tasks === "unavailable";
  const lastMessage = selectedTask?.messages.at(-1);

  useEffect(() => {
    reading.followEnd();
  }, [reading, state.selectedTaskId]);

  useEffect(() => {
    if (lastMessage?.role === "user") reading.followEnd();
    else reading.catchUp();
    const conversation = conversationRef.current;
    if (!conversation || !reading.following()) return;
    // A question taller than the thread is read from its top. Following
    // the tail would scroll its heading, and at a short window the question
    // itself, out of sight above the answers.
    const question = conversation.querySelector<HTMLElement>(
      '[aria-label="Quiz"]',
    );
    if (question && question.offsetHeight > conversation.clientHeight - 32)
      reading.readFrom(question);
  }, [
    reading,
    lastMessage?.id,
    lastMessage?.role,
    lastMessage?.text,
    lastMessage?.reasoning?.text,
    selectedTask?.phase.kind,
    besideOpen,
  ]);

  // The workspace is not always what the window is showing: onboarding and a
  // recovery decision are answered before anything else.
  const workspaceShowing =
    state.connection !== "loading" &&
    !state.newerHistory &&
    !(state.historyRecovery && commands.recoverHistory) &&
    !(
      state.preferences &&
      !state.preferences.onboarded &&
      commands.configureProfile &&
      state.runtime.tasks === "available"
    );
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
      },
      () => permissions.open(task.id),
    );

  if (state.connection === "loading") return <WorkspaceSkeleton />;
  // History a newer version saved is not damage, so it is neither recovered
  // nor started over: nothing here opens it, and the way on is that version.
  if (state.newerHistory)
    return (
      <NewerHistoryGate
        newer={state.newerHistory}
        onGetLatest={() => void commands.openExternalUrl(RELEASES_URL)}
        {...(commands.openDataFolder
          ? { onOpenDataFolder: () => void commands.openDataFolder?.() }
          : {})}
      />
    );
  // Before anything else: saved conversations that will not open are a
  // question only the person can answer, and nothing is written over them
  // until they do.
  if (state.historyRecovery && commands.recoverHistory)
    return (
      <HistoryRecoveryGate
        recovery={state.historyRecovery}
        onChoose={commands.recoverHistory}
        onShowKept={(path) => void commands.showInFolder?.(path)}
      />
    );
  if (
    state.preferences &&
    !state.preferences.onboarded &&
    commands.configureProfile &&
    state.runtime.tasks === "available"
  )
    return <Onboarding onComplete={commands.configureProfile} />;

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
    if (!taskId) await budget.adopt((taskId = await commands.createTask()));
    setComposerDraft(undefined);
    await sendComposerMessage(
      commands.sendMessage,
      taskId,
      message,
      reasoning,
      attachments,
      isRunning,
    );
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
        if (event.key === "Escape") setNavigationOpen(false);
      }}
    >
      <button
        type="button"
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
        onRenameTask={(id, title) => commands.renameTask(id, title)}
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
        commands={commands}
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
            {/* With nothing to name yet, the bar is still there to drag the
                window by and to keep the conversation below its controls. */}
            {!(selectedTask || hasWorkspace) && (
              <div className={styles["top-bar"]} />
            )}
            {(selectedTask || hasWorkspace) && (
              <SessionHeader
                workspace={state.workspace?.name ?? ""}
                title={selectedTask?.title ?? "New task"}
                running={
                  selectedTask && (
                    <RunningCommands
                      taskId={selectedTask.id}
                      running={state.runningCommands[selectedTask.id] ?? []}
                      commands={commands}
                      onListed={(listed) =>
                        dispatch({
                          type: "commandsChanged",
                          taskId: selectedTask.id,
                          commands: listed,
                        })
                      }
                    />
                  )
                }
                viewSelector={
                  hasWorkspace ? (
                    <WorkspaceViewTabs
                      id={workspaceViewId}
                      selected={besideOpen ? "workspace" : "conversation"}
                      live={
                        state.browser.loading ||
                        selectedTask?.phase.kind === "browser"
                      }
                      onSelect={(view) =>
                        view === "workspace"
                          ? viewing.toWorkspace()
                          : viewing.toConversation()
                      }
                    />
                  ) : undefined
                }
                {...(selectedTask?.artifacts.length
                  ? {
                      files: {
                        count: selectedTask.artifacts.length,
                        open: filesOpen,
                        onToggle: () => setFilesOpen((shown) => !shown),
                      },
                    }
                  : {})}
              />
            )}
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
                id={workspaceViewId}
                commands={commands}
                act={act}
              >
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
                            state.compacting.includes(selectedTask.id),
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
                      <WorkspaceNotice
                        {...(viewing.beside.kind === "browser"
                          ? { text: "Zhiyin opened a browser." }
                          : {
                              text: `${viewing.beside.document.name} is open in the workspace.`,
                              icon: "file" as const,
                            })}
                        onShow={viewing.toWorkspace}
                      />
                    )}
                  </div>
                </div>
                {selectedTask && (
                  <ArtifactDrawer
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
                <div
                  className={`${styles["composer-dock"]}${besideOpen ? ` ${styles["composer-dock--compact"]}` : ""}${selectedTask?.phase.kind === "approval" || selectedTask?.phase.kind === "input" ? ` ${styles["composer-dock--deciding"]}` : ""}`}
                >
                  {besideOpen && selectedTask?.phase.kind === "completed" && (
                    <div className={styles["workspace-completion"]}>
                      <button
                        className="text-button"
                        type="button"
                        onClick={viewing.toConversation}
                      >
                        Return to conversation
                      </button>
                    </div>
                  )}
                  {selectedTask?.phase.kind === "approval" && (
                    <div className={styles["composer-dock__decision"]}>
                      <ApprovalPrompt
                        key={selectedTask.phase.prompt.id}
                        {...approvalPromptDetails(selectedTask.phase.prompt)}
                        compact={besideOpen}
                        onDecision={async (decision, reason) => {
                          const prompt =
                            selectedTask.phase.kind === "approval"
                              ? selectedTask.phase.prompt
                              : undefined;
                          if (!prompt) return;
                          await commands.resolveApproval(
                            selectedTask.id,
                            prompt.id,
                            decision === "allow-once"
                              ? "allow"
                              : decision === "allow-conversation"
                                ? "allow-conversation"
                                : "deny",
                            ...(decision === "deny" && reason?.trim()
                              ? [reason.trim()]
                              : []),
                          );
                        }}
                      />
                    </div>
                  )}
                  {selectedTask?.phase.kind === "input" &&
                    selectedTask.phase.prompt.kind !== "quiz" && (
                      <div className={styles["composer-dock__decision"]}>
                        <UserInputPrompt
                          prompt={selectedTask.phase.prompt}
                          onSubmit={submitUserInput}
                          onCancel={stopTask}
                        />
                      </div>
                    )}
                  <div
                    className={styles["workspace-composer"]}
                    hidden={unopened}
                  >
                    <Composer
                      key={selectedTask?.id ?? "new"}
                      {...(state.provider.reasoning
                        ? { reasoningCapabilities: state.provider.reasoning }
                        : {})}
                      {...(selectedTask?.reasoning
                        ? { initialReasoning: selectedTask.reasoning }
                        : {})}
                      onSubmit={submitMessage}
                      context={budget.context}
                      keepPaste={commands.keepPaste}
                      {...(commands.keepPicture
                        ? { keepPicture: commands.keepPicture }
                        : {})}
                      seesPictures={state.provider.acceptsImages === true}
                      {...(commands.readPicture
                        ? { readPicture: commands.readPicture }
                        : {})}
                      // A paste not yet sent belongs to no conversation; one
                      // a rewind put back is still the conversation's.
                      openAttachment={(id) =>
                        void act(() =>
                          commands.openAttachment(selectedTask?.id ?? null, id),
                        )
                      }
                      {...(composerDraft &&
                      composerDraft.taskId === selectedTask?.id
                        ? { draft: composerDraft }
                        : returnedGuidance
                          ? { draft: returnedGuidance }
                          : {})}
                      running={isRunning}
                      onStop={stopTask}
                      scope={
                        <WorkspacePicker
                          disabled={folderLocked}
                          {...(state.workspace
                            ? { current: state.workspace }
                            : {})}
                          recent={state.recentWorkspaces}
                          {...(commands.chooseWorkspace
                            ? {
                                onChoose: () =>
                                  act(() => commands.chooseWorkspace?.()),
                              }
                            : {})}
                          {...(commands.useRecentWorkspace
                            ? {
                                onUseRecent: (path: string) =>
                                  act(() =>
                                    commands.useRecentWorkspace?.(path),
                                  ),
                              }
                            : {})}
                        />
                      }
                      {...composerLock(
                        selectedTask,
                        state.runtime.tasks !== "unavailable",
                      )}
                    />
                  </div>
                </div>
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
