import { useEffect, useId, useRef, useState } from "react";
import type { UserInputResponse } from "@zhiyin/contract";
import { AppSidebar } from "../sidebar/index.js";
import { Icon } from "../shared/index.js";
import { IssueNotices } from "../notices/index.js";
import {
  sidebarConversations,
  sidebarProjects,
} from "./projectConversations.js";
import { useConversationDeletion } from "./useConversationDeletion.js";
import { useAppShortcuts } from "./useAppShortcuts.js";
import { useContextBudget } from "./useContextBudget.js";
import { timelinePieces } from "./timelinePieces.js";
import { WindowPages } from "./WindowPages.js";
import type { WindowCommands } from "./windowCommands.js";
import { taskIsRunning } from "./dockState.js";
import { useBesideView } from "./useBesideView.js";
import { useFollowedConversation } from "./useFollowedConversation.js";
import { useConversationSettle } from "./useConversationSettle.js";
import { modelSetupCommands, windowGate } from "./windowGate.js";
import { ModelSetup } from "../model/index.js";
import {
  useConversationExport,
  useConversationPermissions,
} from "../conversation-dialogs/index.js";
import { useSavedConversationsUpdate } from "./useSavedConversationsUpdate.js";
import { useCommandRunner } from "./useCommandRunner.js";
import { useNewTask } from "./useNewTask.js";
import { NavigationDrawer } from "./NavigationDrawer.js";
import { ConversationColumn } from "./ConversationColumn.js";
import { useDressedWindow } from "./dressedWindow.js";
import type {
  WindowAction,
  WindowState,
  WorkspaceTask,
} from "./windowState.js";
import { listedConversations } from "./windowState.js";
import styles from "./app.module.css";

type WindowShellProps = {
  state: WindowState;
  /** The window came back after its page crashed, and has not said so yet. */
  restarted?: boolean;
  /** The notice was dismissed, or the person went to another page. */
  onRestartNoticed?: () => void;
  dispatch: (action: WindowAction) => void;
  commands: WindowCommands;
};

/**
 * Decides what is on screen and composes the modules: the sidebar, the page
 * or the conversation open, the dialogs over them, and what a failed command
 * says.
 */
export function WindowShell({
  state,
  dispatch,
  commands,
  restarted = false,
  onRestartNoticed,
}: WindowShellProps) {
  // A restart is said on the page it happened on; another page ends it, so
  // coming back does not say it twice.
  useEffect(() => {
    if (restarted && state.surface !== "thread") onRestartNoticed?.();
  }, [restarted, state.surface, onRestartNoticed]);
  useDressedWindow(state.look);
  const { error, act, say } = useCommandRunner(state.commandError, dispatch);
  const [toast, deleteConversation] = useConversationDeletion(
    state,
    commands,
    act,
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
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
  const besideViewId = useId();
  // What is beside the conversation is the core's to decide (ADRs 0019 and
  // 0021): it opens the space the first time the agent uses a browser or
  // writes a document, and keeps a choice the person makes until the agent
  // makes something new elsewhere.
  const viewing = useBesideView(state, commands, act);
  // The person's message open for editing where it is, as taskId:messageId.
  const [editingMessage, setEditingMessage] = useState<string>();
  const conversationRef = useRef<HTMLDivElement>(null);
  const selectedTask =
    state.tasks.find((task) => task.id === state.selectedTaskId) ?? null;
  const budget = useContextBudget(state, selectedTask, commands, () =>
    openNavigationSurface("memory"),
  );
  const newTask = useNewTask({
    state,
    selectedTask,
    running: taskIsRunning(selectedTask),
    commands,
    dispatch,
    act,
    adoptBudget: budget.adopt,
  });
  useFollowedConversation(conversationRef, {
    conversationId: state.selectedTaskId,
    task: selectedTask,
    compact: viewing.open,
  });
  useConversationSettle(conversationRef, state.selectedTaskId);

  // The conversations are not always what the window is showing: onboarding
  // and a recovery decision are answered before anything else.
  const gate = windowGate(state, commands);
  const windowShowing = gate === undefined;
  const savedUpdate = useSavedConversationsUpdate(
    state,
    commands.settleSavedConversations,
    windowShowing,
  );
  useAppShortcuts(windowShowing, {
    newTask: () => startNewTask(),
    openSettings: () => openNavigationSurface("settings"),
    // While the model works on the conversation shown; a decision it waits
    // on is answered, or stopped, from its own card.
    ...(state.surface === "thread" && selectedTask?.phase.kind === "working"
      ? { stopTask: () => stopTask() }
      : {}),
  });

  if (gate) return gate;

  const notices = (
    list: NonNullable<WindowState["issues"]>,
    stacked = false,
  ) => (
    <IssueNotices
      issues={list}
      stacked={stacked}
      openConversationId={state.selectedTaskId}
      retry={
        commands.frontendReady && state.runtime.tasks === "unavailable"
          ? () => void act(() => commands.frontendReady?.())
          : undefined
      }
      onDelete={deleteConversation}
      onUpdate={savedUpdate.ask}
      onShowKept={(path) => void act(() => commands.showInFolder?.(path))}
      onDismiss={(message, conversationId) =>
        void act(() => commands.dismissIssue?.(message, conversationId))
      }
    />
  );

  const pieces = (task: WorkspaceTask) =>
    timelinePieces(
      task,
      commands,
      {
        editing: editingMessage,
        setEditing: setEditingMessage,
        say,
        restoreDraft: newTask.restore,
        openModel: (opening) => {
          setNavigationOpen(false);
          dispatch({
            type: "surfaceOpened",
            surface: "model",
            ...(opening === "apiKey" ? { at: opening } : {}),
          });
        },
        openMemoryEntry: (number) => {
          setNavigationOpen(false);
          dispatch({ type: "surfaceOpened", surface: "memory", at: number });
        },
        ...(state.provider.provider
          ? { provider: state.provider.provider }
          : {}),
        keyMissing: state.provider.credential.status === "missing",
      },
      () => permissions.open(task.id),
    );

  function openSurface(surface: WindowState["surface"]) {
    dispatch({ type: "surfaceOpened", surface });
  }

  function openNavigationSurface(surface: WindowState["surface"]) {
    setNavigationOpen(false);
    openSurface(surface);
  }

  function startNewTask() {
    setNavigationOpen(false);
    newTask.start();
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

  /** Runs a step from the sidebar, closing the drawer it may be in. */
  const fromNavigation =
    <Args extends unknown[]>(step: (...args: Args) => void) =>
    (...args: Args) => {
      setNavigationOpen(false);
      step(...args);
    };

  return (
    <NavigationDrawer
      open={navigationOpen}
      onOpenChange={setNavigationOpen}
      sidebar={(drawer) => (
        <AppSidebar
          drawer={drawer}
          onOpenLibrary={() => openNavigationSurface("library")}
          tasks={sidebarConversations(state)}
          projects={sidebarProjects(state)}
          onNewTaskInProject={fromNavigation(newTask.startIn)}
          onMoveToProject={(id, project) =>
            void act(() => commands.setConversationMemory(id, { project }))
          }
          onKeepNothingFrom={(id, off) =>
            void act(() => commands.setConversationMemory(id, { off }))
          }
          onUpdateConversations={
            savedUpdate.ask && fromNavigation(() => savedUpdate.ask?.())
          }
          selectedId={state.selectedTaskId ?? ""}
          onSelect={fromNavigation(
            (id: string) => void act(() => commands.selectTask(id)),
          )}
          onNewTask={startNewTask}
          onRenameTask={(id, title) =>
            act(() => commands.renameTask(id, title))
          }
          onDeleteTask={deleteConversation}
          onTaskPermissions={fromNavigation(permissions.open)}
          onExportConversation={
            commands.exportConversation && fromNavigation(exporting.open)
          }
          onOpenUsage={() => openNavigationSurface("usage")}
          onOpenModel={() => openNavigationSurface("model")}
          onOpenMemory={() => openNavigationSurface("memory")}
          onOpenSettings={() => openNavigationSurface("settings")}
          modelName={
            state.provider.model
              ? (state.provider.modelName ?? state.provider.model)
              : undefined
          }
          {...(state.appUpdate && commands.restartToUpdate
            ? {
                appUpdate: state.appUpdate,
                onRestartToUpdate: commands.restartToUpdate,
              }
            : {})}
        />
      )}
    >
      <WindowPages
        state={state}
        commands={{
          ...commands,
          // Pages and conversations open from many places on them; a failure
          // is said here.
          openExternalUrl: (url) => act(() => commands.openExternalUrl(url)),
          selectTask: (id) => act(() => commands.selectTask(id)),
        }}
        onOpenSurface={openSurface}
        onStartWith={newTask.startWith}
        onUpdateConversations={savedUpdate.ask}
      />
      {error && (
        <div className={styles["command-error"]} role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => say("")}>
            <Icon name="x" />
          </button>
        </div>
      )}

      {state.surface === "thread" && (
        <ConversationColumn
          state={state}
          task={selectedTask}
          commands={commands}
          dispatch={dispatch}
          act={act}
          viewing={viewing}
          viewId={besideViewId}
          conversationRef={conversationRef}
          files={{ open: filesOpen, setOpen: setFilesOpen }}
          restarted={restarted}
          onRestartNoticed={onRestartNoticed}
          notices={notices}
          pieces={pieces}
          composer={{
            composerKey: newTask.composerKey,
            draft: newTask.draft,
            context: budget.context,
          }}
          onSubmit={newTask.submit}
          onBegin={newTask.fill}
          setup={
            state.provider.model &&
            state.provider.credential.status === "configured" ? undefined : (
              // Until a model can answer, the new-task page offers to
              // connect one, as onboarding did.
              <ModelSetup
                settings={state.provider}
                {...modelSetupCommands(commands)}
              />
            )
          }
          onStop={stopTask}
          onUserInput={submitUserInput}
        />
      )}
      {permissions.panel}
      {exporting.panel}
      {savedUpdate.panel}
      {toast}
    </NavigationDrawer>
  );
}
