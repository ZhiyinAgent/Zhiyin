import { ActionHistory, SpecialistRunHistory } from "../actions/index.js";
import type { TimelinePieces, WaitingOn } from "../conversation/index.js";
import { TaskViewCard } from "../views/index.js";
import { InteractionCard } from "../user-input/index.js";
import { RewindMessage } from "../rewind/index.js";
import type {
  SpecialistRun,
  TaskAction,
  TaskInteraction,
  TaskView,
  WorkspaceTask,
} from "./workspaceState.js";
import type { WorkspaceCommands } from "./WorkspaceShell.js";
import type { MessageAttachment } from "@zhiyin/contract";

/**
 * The specialists a finished turn left running, which is all the conversation
 * is waiting on; nothing while the turn itself is still working.
 */
function waitingOn(task: WorkspaceTask): WaitingOn | undefined {
  if (task.phase.kind !== "completed") return undefined;
  const running = (task.specialistRuns ?? []).filter(
    (run) => run.status === "running",
  );
  if (running.length === 0) return undefined;
  const ids = new Set(running.map((run) => run.id));
  const calls = new Set([
    ...running.flatMap((run) => run.actionIds),
    ...(task.actions ?? [])
      .filter(
        (action) => action.specialistRunId && ids.has(action.specialistRunId),
      )
      .map((action) => action.id),
  ]).size;
  return {
    names: [...new Set(running.map((run) => run.specialist.name))],
    calls,
    since: running
      .map((run) => run.startedAt)
      .reduce((earliest, startedAt) =>
        Date.parse(startedAt) < Date.parse(earliest) ? startedAt : earliest,
      ),
  };
}

/**
 * The task as the conversation draws it. A specialist's own actions are drawn
 * under its run, not a second time in the main history.
 */
export function timelineTask(task: WorkspaceTask) {
  const specialistOwned = new Set([
    ...(task.specialistRuns ?? []).flatMap((run) => run.actionIds),
    ...(task.actions ?? [])
      .filter((action) => action.specialistRunId)
      .map((action) => action.id),
  ]);
  const waiting = waitingOn(task);
  return {
    ...task,
    ...(waiting ? { waitingOn: waiting } : {}),
    actions: (task.actions ?? []).filter(
      (action) => !specialistOwned.has(action.id),
    ),
  };
}

/** What the shell hands back when a rewind lands. */
type RewindLanding = {
  say(message: string): void;
  restoreDraft(draft: {
    id: string;
    taskId: string;
    text: string;
    attachments?: readonly MessageAttachment[];
  }): void;
};

/**
 * What the conversation draws through other modules: the record of actions,
 * views, answered questions, and a person's own messages, which can be rewound
 * when the core offers it.
 *
 * Each piece is drawn by the module that owns the thing it shows. This decides
 * only which of them the conversation gets, and a piece whose command the core
 * did not offer is not among them.
 */
export function timelinePieces(
  task: WorkspaceTask,
  commands: WorkspaceCommands,
  landing: RewindLanding,
  onOpenPermission?: (permissionId: string) => void,
): TimelinePieces<TaskAction, TaskView, TaskInteraction, SpecialistRun> {
  const previewRewind = commands.previewRewind;
  const commitRewind = commands.commitRewind;
  const exportView = commands.exportView;
  const readPicture = commands.readPicture;
  return {
    openAttachment: (id) => void commands.openAttachment(task.id, id),
    ...(previewRewind && commitRewind
      ? {
          userMessage: (message, busy, bubble) => (
            <RewindMessage
              taskId={task.id}
              messageId={message.id}
              bubble={bubble}
              disabled={busy}
              onPreview={previewRewind}
              onCommit={commitRewind}
              onCommitted={(draft, result) => {
                const unresolved = result.files.filter(
                  (file) =>
                    file.status === "conflict" || file.status === "unprotected",
                );
                if (unresolved.length)
                  landing.say(
                    `Conversation rewound. ${unresolved.length} ${unresolved.length === 1 ? "file was" : "files were"} left unchanged because recovery was unavailable or unsafe.`,
                  );
                landing.restoreDraft({
                  id: `${task.id}:${message.id}:${Date.now()}`,
                  taskId: task.id,
                  text: draft,
                  ...(message.attachments
                    ? { attachments: message.attachments }
                    : {}),
                });
              }}
            />
          ),
        }
      : {}),
    actions: (actions: TaskAction[]) => (
      <ActionHistory
        actions={actions}
        {...(onOpenPermission ? { onOpenPermission } : {})}
        {...(readPicture ? { readPicture } : {})}
      />
    ),
    view: (view: TaskView) => (
      <TaskViewCard
        view={view}
        {...(exportView
          ? { onSave: (svg: string) => exportView(task.id, view.id, svg) }
          : {})}
      />
    ),
    interaction: (interaction: TaskInteraction) => (
      <InteractionCard interaction={interaction} />
    ),
    specialistRun: (run: SpecialistRun) => (
      <SpecialistRunHistory
        run={run}
        actions={task.actions ?? []}
        {...(onOpenPermission ? { onOpenPermission } : {})}
        {...(readPicture ? { readPicture } : {})}
      />
    ),
  };
}
