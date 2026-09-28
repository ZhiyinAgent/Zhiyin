import { useEffect, useId, useRef, useState } from "react";
import { Onboarding } from "../onboarding/index.js";
import { HistoryRecoveryGate } from "../recovery/index.js";
import type {
  CoreApi,
  UserInputResponse,
  MessageAttachment,
  ReasoningSelection,
} from "@zhiyin/contract";
import { ApprovalPrompt } from "../actions/index.js";
import { WorkspacePicker } from "./WorkspacePicker.js";
import { AppSidebar } from "./AppSidebar.js";
import { ArtifactDrawer } from "../artifacts/index.js";
import {
  Composer,
  ContextShelf,
  ConversationTimeline,
  NewConversation,
  useReadingPosition,
} from "../conversation/index.js";
import { Icon, Notice } from "../shared/index.js";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton.js";
import { useAppShortcuts } from "./useAppShortcuts.js";
import { useContextBudget } from "./useContextBudget.js";
import { timelinePieces } from "./timelinePieces.js";
import { WorkspaceSurfaces } from "./WorkspaceSurfaces.js";
import { approvalPromptDetails, composerLock } from "./dockState.js";
import { BrowserNotice, BrowserWorkspace } from "../browser/index.js";
import { RestartNotice } from "./RestartNotice.js";
import { SessionHeader } from "./SessionHeader.js";
import { WorkspaceViewTabs } from "./WorkspaceViewTabs.js";
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
  /** The window was reloaded after its page crashed. */
  restarted?: boolean;
  dispatch: (action: WorkspaceAction) => void;
  commands: Pick<
    CoreApi,
    | "createTask"
    | "selectTask"
    | "renameTask"
    | "deleteTask"
    | "sendMessage"
    | "keepPaste"
    | "setContextBudget"
    | "setDefaultContextBudget"
    | "setPersonalInstructions"
    | "condenseNow"
    | "openAttachment"
    | "interruptTask"
    | "resolveApproval"
    | "resolveUserInput"
    | "setPluginEnabled"
    | "installPlugin"
    | "updatePlugin"
    | "rollbackPlugin"
    | "removePlugin"
    | "createPlugin"
    | "savePluginContents"
    | "editablePluginContents"
    | "setComponentEnabled"
    | "componentContent"
    | "overrideComponent"
    | "resetComponent"
    | "installToolchain"
    | "setMcpServerToolEnabled"
    | "testMcpConnection"
    | "saveMcpServerToken"
    | "clearMcpServerToken"
    | "refreshConnections"
    | "shellAvailability"
    | "recheckShell"
    | "openExternalUrl"
    | "driveBrowser"
    | "saveProviderApiKey"
    | "clearProviderApiKey"
    | "listModels"
    | "listModelProviders"
    | "selectModel"
    | "configureProfile"
    | "recoverHistory"
    | "chooseWorkspace"
    | "useRecentWorkspace"
    | "previewArtifact"
    | "exportArtifact"
  > &
    Partial<
      Pick<
        CoreApi,
        | "frontendReady"
        | "exportView"
        | "readPicture"
        | "selectNothing"
        | "previewRewind"
        | "commitRewind"
        | "readEvidence"
        | "clearEvidence"
      >
    >;
};

/** Everything the window can ask the core to do. */
export type WorkspaceCommands = WorkspaceShellProps["commands"];

const unavailableEvidence = async (): Promise<never> => {
  throw new Error("Evidence storage is unavailable.");
};

export function WorkspaceShell({
  state,
  dispatch,
  commands,
  restarted = false,
}: WorkspaceShellProps) {
  // Held with the rest of the window's state rather than beside it, so the
  // message survives the pages of the app changing under it.
  const commandError = state.commandError ?? "";
  const setCommandError = (message: string) =>
    dispatch({ type: "commandErrorShown", message });
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const workspaceViewId = useId();
  const [viewChoice, setViewChoice] = useState<{
    taskId: string | null;
    view: "conversation" | "browser";
  }>();
  /** The task whose browser has already shown itself once. */
  const [shown, setShown] = useState<{ taskId: string | null }>();
  const hasBrowser = state.browser.status !== "closed";
  if (!hasBrowser && viewChoice) setViewChoice(undefined);
  // A browser opens because Zhiyin needed one, and it opens beside the
  // conversation rather than over it — so showing it is how a person finds out
  // the workspace is there at all. Once per task: after that, whether the
  // browser is worth watching is their judgement, not ours.
  else if (hasBrowser && shown?.taskId !== state.selectedTaskId) {
    setShown({ taskId: state.selectedTaskId });
    setViewChoice({ taskId: state.selectedTaskId, view: "browser" });
  }
  const browserView =
    hasBrowser &&
    viewChoice?.taskId === state.selectedTaskId &&
    viewChoice.view === "browser";
  const selectView = (view: "conversation" | "browser") =>
    setViewChoice({ taskId: state.selectedTaskId, view });
  const [composerDraft, setComposerDraft] = useState<{
    readonly id: string;
    readonly taskId: string;
    readonly text: string;
    readonly attachments?: readonly MessageAttachment[];
  }>();
  const conversationRef = useRef<HTMLDivElement>(null);
  const followConversationTail = useRef(true);
  // Opening or closing the browser resizes this column, which rewraps every
  // message. Where someone was reading survives that; a scroll offset in
  // pixels would not.
  useReadingPosition(conversationRef);
  const selectedTask =
    state.tasks.find((task) => task.id === state.selectedTaskId) ?? null;
  // A specialist's own actions are drawn nested under its run in the
  // timeline, not a second time in the main action-history list.
  const specialistOwnedActionIds = new Set([
    ...(selectedTask?.specialistRuns ?? []).flatMap((run) => run.actionIds),
    ...(selectedTask?.actions ?? [])
      .filter((action) => action.specialistRunId)
      .map((action) => action.id),
  ]);
  const context = selectedTask?.context;
  const budget = useContextBudget(state, selectedTask, commands, () =>
    openNavigationSurface("settings"),
  );
  const isRunning =
    selectedTask?.phase.kind === "working" ||
    selectedTask?.phase.kind === "browser" ||
    selectedTask?.phase.kind === "loading";
  /**
   * Changing folder is only safe when nothing is depending on the current
   * one — not mid-turn, and not while a decision about an action scoped to it
   * is still open.
   */
  const folderLocked =
    isRunning ||
    selectedTask?.phase.kind === "approval" ||
    selectedTask?.phase.kind === "input" ||
    state.runtime.tasks === "unavailable";
  const lastMessage = selectedTask?.messages.at(-1);

  useEffect(() => {
    followConversationTail.current = true;
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [state.selectedTaskId]);

  useEffect(() => {
    if (lastMessage?.role === "user") followConversationTail.current = true;
    const conversation = conversationRef.current;
    if (conversation && followConversationTail.current) {
      conversation.scrollTop = conversation.scrollHeight;
    }
  }, [
    lastMessage?.id,
    lastMessage?.role,
    lastMessage?.text,
    lastMessage?.reasoning?.text,
    selectedTask?.phase.kind,
    browserView,
  ]);

  // The workspace is not always what the window is showing: onboarding and a
  // recovery decision are answered before anything else.
  const workspaceShowing =
    state.connection !== "loading" &&
    !(state.historyRecovery && commands.recoverHistory) &&
    !(
      state.preferences &&
      !state.preferences.onboarded &&
      commands.configureProfile &&
      state.runtime.tasks === "available"
    );
  useAppShortcuts(workspaceShowing, {
    newTask: () => startNewTask(),
    openSettings: () => openNavigationSurface("settings"),
  });

  const pieces = (task: WorkspaceTask) =>
    timelinePieces(task, commands, {
      say: setCommandError,
      restoreDraft: setComposerDraft,
    });

  if (state.connection === "loading") return <WorkspaceSkeleton />;
  // Before anything else: saved conversations that will not open are a
  // question only the person can answer, and nothing is written over them
  // until they do.
  if (state.historyRecovery && commands.recoverHistory)
    return (
      <HistoryRecoveryGate
        recovery={state.historyRecovery}
        onChoose={commands.recoverHistory}
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
    if (attachments?.length)
      await commands.sendMessage(
        taskId,
        message,
        reasoning,
        attachments.map((attachment) => attachment.id),
      );
    else await commands.sendMessage(taskId, message, reasoning);
  }

  function openSurface(surface: WorkspaceState["surface"]) {
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
      className={`${styles["app-shell"]}${context || state.browser.status !== "closed" ? "" : ` ${styles["app-shell--no-context"]}`}${state.browser.status !== "closed" ? ` ${styles["app-shell--browser"]}` : ""}${navigationOpen ? ` ${styles["app-shell--navigation-open"]}` : ""}`}
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
        <Icon name={navigationOpen ? "x" : "folder"} />
      </button>
      <AppSidebar
        onOpenLibrary={() => openNavigationSurface("library")}
        tasks={listedConversations(state).map((item) => ({
          id: item.id,
          title: item.title,
          ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
          meta: item.updatedLabel,
        }))}
        selectedId={state.selectedTaskId ?? ""}
        onSelect={(id) => {
          setNavigationOpen(false);
          void act(() => commands.selectTask(id));
        }}
        onNewTask={startNewTask}
        onRenameTask={(id, title) => commands.renameTask(id, title)}
        onDeleteTask={(id) => commands.deleteTask(id)}
        onOpenUsage={() => openNavigationSurface("usage")}
        onOpenEvidence={() => openNavigationSurface("evidence")}
        onOpenSettings={() => openNavigationSurface("settings")}
      />

      <WorkspaceSurfaces
        state={state}
        commands={{
          ...commands,
          readEvidence: commands.readEvidence ?? unavailableEvidence,
          clearEvidence: commands.clearEvidence ?? unavailableEvidence,
        }}
        onOpenSurface={openSurface}
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
            {(selectedTask || hasBrowser) && (
              <SessionHeader
                workspace={state.workspace?.name ?? ""}
                title={selectedTask?.title ?? "New task"}
                viewSelector={
                  hasBrowser ? (
                    <WorkspaceViewTabs
                      id={workspaceViewId}
                      selected={browserView ? "browser" : "conversation"}
                      live={
                        state.browser.loading ||
                        selectedTask?.phase.kind === "browser"
                      }
                      onSelect={selectView}
                    />
                  ) : undefined
                }
                {...(selectedTask?.artifacts?.length
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
              {restarted && <RestartNotice />}
              <BrowserWorkspace
                browser={state.browser}
                split={browserView}
                id={workspaceViewId}
                onReturn={() => selectView("conversation")}
                onDrive={async (intent) => {
                  if (commands) await act(() => commands.driveBrowser(intent));
                }}
              >
                <div className={styles["workspace-view"]}>
                  <div
                    className={`${styles["thread-scroll"]}${selectedTask ? "" : ` ${styles["thread-scroll--new"]}`}${browserView ? ` ${styles["thread-scroll--compact"]}` : ""}`}
                    ref={conversationRef}
                    role="log"
                    aria-label="Task conversation"
                    aria-busy={isRunning}
                    onScroll={(event) => {
                      const target = event.currentTarget;
                      followConversationTail.current =
                        target.scrollHeight -
                          target.scrollTop -
                          target.clientHeight <
                        80;
                    }}
                  >
                    {state.issues?.map((issue) => (
                      <Notice role="alert" key={issue}>
                        <p>{issue}</p>
                        {commands.frontendReady && (
                          <button
                            className="button"
                            onClick={() =>
                              void act(() => commands.frontendReady?.())
                            }
                          >
                            Try again
                          </button>
                        )}
                      </Notice>
                    ))}
                    {!selectedTask && (
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
                      <ConversationTimeline
                        task={{
                          ...selectedTask,
                          actions: (selectedTask.actions ?? []).filter(
                            (action) =>
                              !specialistOwnedActionIds.has(action.id),
                          ),
                        }}
                        pieces={pieces(selectedTask)}
                        compact={browserView}
                      />
                    )}
                    {selectedTask?.phase.kind === "input" &&
                      selectedTask.phase.prompt.kind === "quiz" && (
                        <UserInputPrompt
                          prompt={selectedTask.phase.prompt}
                          onSubmit={submitUserInput}
                          onCancel={stopTask}
                        />
                      )}
                    {hasBrowser && !browserView && (
                      <BrowserNotice onShow={() => selectView("browser")} />
                    )}
                  </div>
                </div>
                {selectedTask && (
                  <ArtifactDrawer
                    artifacts={selectedTask.artifacts ?? []}
                    open={filesOpen}
                    onClose={() => setFilesOpen(false)}
                    onPreview={(path) =>
                      commands.previewArtifact(selectedTask.id, path)
                    }
                    onExport={(path) =>
                      commands.exportArtifact(selectedTask.id, path)
                    }
                  />
                )}
                <div
                  className={`${styles["composer-dock"]}${browserView ? ` ${styles["composer-dock--compact"]}` : ""}`}
                >
                  {browserView && selectedTask?.phase.kind === "completed" && (
                    <div className={styles["workspace-completion"]}>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => selectView("conversation")}
                      >
                        Return to conversation
                      </button>
                    </div>
                  )}
                  {selectedTask?.phase.kind === "approval" && (
                    <div className={styles["composer-dock__decision"]}>
                      <ApprovalPrompt
                        {...approvalPromptDetails(selectedTask.phase.prompt)}
                        compact={browserView}
                        onDecision={async (decision, reason) => {
                          const prompt =
                            selectedTask.phase.kind === "approval"
                              ? selectedTask.phase.prompt
                              : undefined;
                          if (!prompt) return;
                          await commands.resolveApproval(
                            selectedTask.id,
                            prompt.id,
                            decision === "allow-once" ? "allow" : "deny",
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
                  <div className={styles["workspace-composer"]}>
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
              </BrowserWorkspace>
            </main>
          </section>
          {!hasBrowser && context && (
            <div className={styles["app-shell__context"]}>
              <ContextShelf context={context} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
