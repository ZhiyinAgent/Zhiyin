import { ActionHistory, SpecialistRunHistory } from "../actions/index.js";
import type { TimelinePieces } from "../conversation/index.js";
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
