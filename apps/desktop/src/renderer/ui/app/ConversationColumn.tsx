import {
  useCallback,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import type { UserInputResponse, WorkspaceIssue } from "@zhiyin/contract";
import { ArtifactDrawer } from "../artifacts/index.js";
import {
  ConversationTimeline,
  NewConversation,
  OpenCitation,
  OpenLink,
  PlanPill,
  type Starter,
  type TimelinePieces,
} from "../conversation/index.js";
import { UserInputPrompt } from "../user-input/index.js";
import { BesideNotice } from "../beside/index.js";
import { ComposerDock } from "./ComposerDock.js";
import { ConversationHeader } from "./ConversationHeader.js";
import { taskIsRunning } from "./dockState.js";
import { ConversationWithBeside } from "./ConversationWithBeside.js";
import { RestartNotice } from "../notices/index.js";
import { timelineTask } from "./turns.js";
import type { BesideConversation, useBesideView } from "./useBesideView.js";
import type { WindowCommands } from "./windowCommands.js";
import type {
  SpecialistRun,
  TaskAction,
  TaskInteraction,
  TaskView,
  WindowAction,
  WindowState,
  WorkspaceTask,
} from "./windowState.js";
import styles from "./app.module.css";

type ComposerDockProps = ComponentProps<typeof ComposerDock>;

/** What the 3D view holds, said in the conversation while it is put away. */
function threeDNotice(
  beside: Extract<BesideConversation, { kind: "3d" }>,
): string {
  const parts = beside.shows === "parts" ? beside.parts?.parts : undefined;
  if (parts)
    return parts.length === 1
      ? `${parts[0]!.name} is built and open in the 3D view.`
      : `${parts.length} parts are built and open in the 3D view.`;
  return `${beside.scene?.file?.split("/").pop() ?? "A 3D scene"} is open in the 3D view.`;
}

/** Says in the conversation what is open beside it, and offers to show it. */
function WhatIsBeside({
  beside,
  onShow,
}: {
  beside: BesideConversation;
  onShow: () => void;
}) {
  return (
    <BesideNotice
      surface={beside.kind}
      text={
        beside.kind === "browser"
          ? "Zhiyin opened a browser."
          : beside.kind === "3d"
            ? threeDNotice(beside)
            : `${beside.document.name} is open beside the conversation.`
      }
      onShow={onShow}
    />
  );
}

/**
 * The ways to begin the plugins that are on offer: each one's first prompt,
 * with its name, in the order the plugins are listed.
 */
function startersOf(plugins: WindowState["plugins"]): readonly Starter[] {
  return plugins.flatMap((plugin) => {
    const prompt = plugin.defaultPrompts[0];
    return plugin.enabled && plugin.status !== "failed" && prompt
      ? [{ plugin: plugin.name, prompt }]
      : [];
  });
}

/**
 * The selected conversation, or the empty one New conversation shows: its header, the
 * plan and the reports that concern it over it, its timeline, the files it
 * made, what is beside it, and the composer under it.
 */
export function ConversationColumn({
  state,
  task,
  commands,
  dispatch,
  act,
  viewing,
  viewId,
  conversationRef,
  files,
  restarted,
  onRestartNoticed,
  notices,
  pieces,
  composer,
  onSubmit,
  onBegin,
  setup,
  onStop,
  onUserInput,
}: {
  state: WindowState;
  task: WorkspaceTask | null;
  commands: WindowCommands;
  dispatch: (action: WindowAction) => void;
  /** Runs a command, showing its failure in the window. */
  act: (operation: () => void | Promise<unknown>) => Promise<void>;
  viewing: ReturnType<typeof useBesideView>;
  /** Names the tabs and the panel they choose for each other. */
  viewId: string;
  /** The scrolling conversation, which the shell keeps its reader in. */
  conversationRef: RefObject<HTMLDivElement | null>;
  /** The files drawer, open or not. */
  files: { readonly open: boolean; readonly setOpen: (open: boolean) => void };
  /** The window came back after its page crashed, and has not said so yet. */
  restarted: boolean;
  onRestartNoticed?: (() => void) | undefined;
  /** Draws reports from the core. */
  notices: (issues: readonly WorkspaceIssue[], stacked?: boolean) => ReactNode;
  pieces: (
    task: WorkspaceTask,
  ) => TimelinePieces<TaskAction, TaskView, TaskInteraction, SpecialistRun>;
  /** Which composer shows, and what it starts with. */
  composer: Pick<ComposerDockProps, "composerKey" | "draft" | "context">;
  onSubmit: ComposerDockProps["onSubmit"];
  /** Writes a way to begin into the message, unsent. */
  onBegin: (text: string) => void;
  /** How to connect a model, while none is ready to answer. */
  setup?: ReactNode;
  onStop: () => void;
  onUserInput: (response: UserInputResponse) => Promise<void>;
}) {
  const besideOpen = viewing.open;
  // The same function each render: every answer's markdown is drawn again
  // when it changes.
  const openLink = useCallback(
    (url: string) => void act(() => commands.openAnswerLink(url)),
    [act, commands],
  );
  // Selected but not open: a conversation that could not be read, shown as
  // its report in its place.
  const unopened = state.selectedTaskId !== null && !task;
  // The new-task page: nothing said yet, and nothing failed to open.
  const welcoming =
    !unopened &&
    (!task || (task.phase.kind === "draft" && task.messages.length === 0));
  const issues = state.issues ?? [];
  const concernsOpen = (issue: { conversationId?: string }) =>
    issue.conversationId === state.selectedTaskId;
  // Reports stay in view above the conversation, however far it is scrolled;
  // the unopened conversation's own report takes the conversation's place.
  const pinnedIssues = issues.filter(
    (issue) => !issue.conversationId || (concernsOpen(issue) && !unopened),
  );
  const ownIssues = unopened ? issues.filter(concernsOpen) : [];

  return (
    <section className={styles["session-pane"]}>
      <ConversationHeader
        state={state}
        task={task}
        commands={commands}
        dispatch={dispatch}
        viewing={viewing}
        viewId={viewId}
        files={{
          open: files.open,
          onToggle: () => files.setOpen(!files.open),
        }}
      />
      <main
        className={`${styles["thread-view"]}${
          task?.phase.kind === "approval" || task?.phase.kind === "input"
            ? ` ${styles["thread-view--approval"]}`
            : ""
        }`}
      >
        <ConversationWithBeside
          viewing={viewing}
          taskId={state.selectedTaskId}
          agentWorking={task?.phase.kind === "working"}
          id={viewId}
          commands={commands}
          act={act}
        >
          <div
            className={`${styles["conversation-landscape"]}${welcoming ? ` ${styles["conversation-landscape--new"]}` : ""}`}
            aria-hidden="true"
          />
          <div className={styles["conversation-view"]}>
            {restarted && (
              // Over the conversation column, whatever is beside it.
              <div className={styles["restart-anchor"]}>
                <RestartNotice onDismiss={() => onRestartNoticed?.()} />
              </div>
            )}
            <PlanPill key={task?.id} items={task?.plan ?? []} />
            {pinnedIssues.length > 0 && (
              <div className={styles["issue-stack"]}>
                {notices(pinnedIssues, true)}
              </div>
            )}
            <div
              className={`${styles["thread-scroll"]}${task ? "" : ` ${styles["thread-scroll--new"]}`}${besideOpen ? ` ${styles["thread-scroll--compact"]}` : ""}`}
              ref={conversationRef}
              role="log"
              aria-label="Task conversation"
              aria-busy={taskIsRunning(task)}
            >
              {unopened && notices(ownIssues)}
              {welcoming && (
                <NewConversation
                  onSuggestion={onBegin}
                  disabled={state.runtime.tasks === "unavailable"}
                  starters={startersOf(state.plugins)}
                  setup={
                    state.runtime.tasks !== "unavailable" ? setup : undefined
                  }
                />
              )}
              {task && task.messages.length > 0 && (
                <OpenCitation.Provider value={viewing.cite}>
                  <OpenLink.Provider value={openLink}>
                    <ConversationTimeline
                      task={timelineTask(
                        task,
                        state.compacting.find((item) => item.taskId === task.id)
                          ?.since,
                      )}
                      pieces={pieces(task)}
                      compact={besideOpen}
                    />
                  </OpenLink.Provider>
                </OpenCitation.Provider>
              )}
              {task?.phase.kind === "input" &&
                task.phase.prompt.kind === "quiz" && (
                  <UserInputPrompt
                    prompt={task.phase.prompt}
                    onSubmit={onUserInput}
                    onCancel={onStop}
                  />
                )}
              {viewing.beside && !besideOpen && (
                <WhatIsBeside
                  beside={viewing.beside}
                  onShow={viewing.toBeside}
                />
              )}
            </div>
          </div>
          {task && (
            <ArtifactDrawer
              conversationId={task.id}
              folder={task.workspace?.path}
              artifacts={task.artifacts}
              open={files.open}
              onClose={() => files.setOpen(false)}
              onPreview={(path) => commands.previewArtifact(task.id, path)}
              onExport={(path) => commands.exportArtifact(task.id, path)}
              onShowBeside={(path) => {
                files.setOpen(false);
                void act(async () => {
                  const outcome = await commands.showDocument(task.id, path);
                  if (!outcome.ok) throw new Error(outcome.reason);
                });
              }}
            />
          )}
          <ComposerDock
            composerKey={composer.composerKey}
            state={state}
            task={task}
            commands={commands}
            act={act}
            compact={besideOpen}
            hidden={unopened}
            draft={composer.draft}
            context={composer.context}
            onSubmit={onSubmit}
            onStop={onStop}
            onUserInput={onUserInput}
            onReturnToConversation={viewing.toConversation}
          />
        </ConversationWithBeside>
      </main>
    </section>
  );
}
