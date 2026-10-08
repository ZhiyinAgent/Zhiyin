import {
  ActionHistory,
  SpecialistRunHistory,
  TurnFiles,
  touchesFiles,
} from "../actions/index.js";
import type { TimelinePieces, WaitingOn } from "../conversation/index.js";
import { TaskViewCard } from "../views/index.js";
import { InteractionCard } from "../user-input/index.js";
import {
  FailedTurnActions,
  RewindMessage,
  type GoingBackProps,
  type OtherStep,
} from "../rewind/index.js";
import type {
  SpecialistRun,
  TaskAction,
  TaskInteraction,
  TaskView,
  WorkspaceTask,
} from "./workspaceState.js";
import type { WorkspaceCommands } from "./workspaceCommands.js";
import {
  OPENROUTER_CREDITS_URL,
  type MessageAttachment,
  type RewindCommitResult,
} from "@zhiyin/contract";

/**
 * The specialists a finished turn left running, which is all the conversation
 * is waiting on; nothing while the turn itself is still working.
 */
function waitingOn(task: WorkspaceTask): WaitingOn | undefined {
  if (task.phase.kind !== "completed") return undefined;
  const running = task.specialistRuns.filter((run) => run.status === "running");
  if (running.length === 0) return undefined;
  const ids = new Set(running.map((run) => run.id));
  const calls = new Set([
    ...running.flatMap((run) => run.actionIds),
    ...task.actions
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
export function timelineTask(task: WorkspaceTask, compacting = false) {
  const specialistOwned = new Set([
    ...task.specialistRuns.flatMap((run) => run.actionIds),
    ...task.actions
      .filter((action) => action.specialistRunId)
      .map((action) => action.id),
  ]);
  const waiting = waitingOn(task);
  return {
    ...task,
    ...(waiting ? { waitingOn: waiting } : {}),
    ...(compacting ? { compacting } : {}),
    actions: task.actions.filter((action) => !specialistOwned.has(action.id)),
  };
}

/**
 * What the shell does for a piece: tell, fill the composer, open the Model
 * page, and hold which of the person's messages is open for editing.
 */
type RewindLanding = {
  /** The message open for editing, as `taskId:messageId`. */
  editing?: string | undefined;
  setEditing(key: string | undefined): void;
  say(message: string): void;
  /** Settings, on the key dialog or the model list. */
  openSettings(opening: "apiKey" | "model"): void;
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
  const previewUndo = commands.previewUndo;
  const commitUndo = commands.commitUndo;
  const compareDocument = commands.compareDocument;
  const exportView = commands.exportView;
  const readPicture = commands.readPicture;
  function reportUnresolved(result: RewindCommitResult) {
    const unresolved = result.files.filter(
      (file) => file.status === "conflict" || file.status === "unprotected",
    );
    if (unresolved.length)
      landing.say(
        `Conversation rewound. ${unresolved.length} ${unresolved.length === 1 ? "file was" : "files were"} left unchanged because recovery was unavailable or unsafe.`,
      );
  }
  function backInComposer(
    message: {
      readonly id: string;
      readonly attachments?: readonly MessageAttachment[];
    },
    text: string,
  ) {
    landing.restoreDraft({
      id: `${task.id}:${message.id}:${Date.now()}`,
      taskId: task.id,
      text,
      ...(message.attachments ? { attachments: message.attachments } : {}),
    });
  }
  const editingKey = (messageId: string) => `${task.id}:${messageId}`;
  /**
   * Going back to one of the person's messages, to send it again as it was or
   * edited. Its pastes and pictures go with it either way.
   */
  function goingBackTo(message: {
    readonly id: string;
    readonly text: string;
    readonly attachments?: readonly MessageAttachment[];
  }): GoingBackProps | undefined {
    if (!previewRewind || !commitRewind) return undefined;
    return {
      taskId: task.id,
      messageId: message.id,
      text: message.text,
      onPreview: previewRewind,
      onCommit: commitRewind,
      onSend: async (result, words) => {
        reportUnresolved(result);
        const ids = message.attachments?.map((attachment) => attachment.id);
        try {
          await (ids?.length
            ? commands.sendMessage(task.id, words, task.reasoning, ids)
            : commands.sendMessage(task.id, words, task.reasoning));
        } catch (cause) {
          // The rewind has already removed it from the conversation, so the
          // message goes where it can be sent from again.
          backInComposer(message, words);
          landing.say(
            `The message was not sent again${cause instanceof Error ? `: ${cause.message}` : "."} It is back in the message box.`,
          );
        }
      },
    };
  }
  function takeStep(step: OtherStep) {
    if (step === "updateApiKey") landing.openSettings("apiKey");
    else if (step === "addCredits")
      void commands.openExternalUrl(OPENROUTER_CREDITS_URL);
    else if (step === "continue")
      void commands
        .sendMessage(task.id, "Continue.", task.reasoning)
        .catch((cause: unknown) =>
          landing.say(
            cause instanceof Error
              ? cause.message
              : "The conversation could not continue. Try again.",
          ),
        );
    else landing.openSettings("model");
  }
  // The message the failed turn answered: the last one the person wrote that
  // is not an answer to a question.
  const answered = task.messages.findLast(
    (message) => message.role === "user" && !message.interactionId,
  );
  const answeredGoingBack = answered && goingBackTo(answered);
  /**
   * Every action of the turn a message opened, a specialist's included: those
   * recorded after it and before the next message the person wrote that is not
   * an answer to a question.
   */
  function turnActions(opening: { readonly sequence: number }) {
    const start = opening.sequence;
    const end =
      task.messages.find(
        (message) =>
          message.role === "user" &&
          !message.interactionId &&
          message.sequence > start,
      )?.sequence ?? Infinity;
    return task.actions.filter(
      (action) => action.sequence > start && action.sequence < end,
    );
  }
  return {
    openAttachment: (id) => void commands.openAttachment(task.id, id),
    ...(readPicture ? { readPicture } : {}),
    ...(previewRewind && commitRewind
      ? {
          userMessage: (message, busy, bubble) => {
            const going = goingBackTo(message);
            return going ? (
              <RewindMessage
                {...going}
                bubble={bubble}
                disabled={busy}
                editing={landing.editing === editingKey(message.id)}
                onEditing={(on) =>
                  landing.setEditing(on ? editingKey(message.id) : undefined)
                }
              />
            ) : (
              bubble
            );
          },
        }
      : {}),
    turnEnd: (opening, running) => {
      const actions = turnActions(opening);
      // Decided here, not inside the summary: the conversation draws a
      // response around whatever this returns, and an element that renders
      // nothing would still leave Zhiyin's mark on an empty row.
      if (running || !touchesFiles(actions)) return null;
      const undone = task.undos.find((undo) => undo.messageId === opening.id);
      return (
        <TurnFiles
          actions={actions}
          running={running}
          {...(undone ? { undone } : {})}
          {...(previewUndo && commitUndo
            ? {
                onPreviewUndo: () => previewUndo(task.id, opening.id),
                onCommitUndo: (undoId: string) => commitUndo(task.id, undoId),
              }
            : {})}
          {...(compareDocument
            ? {
                onCompareDocument: (path: string) =>
                  compareDocument(task.id, opening.id, path),
              }
            : {})}
        />
      );
    },
    failure: (remedies) => (
      <FailedTurnActions
        remedies={remedies}
        {...(answeredGoingBack && answered
          ? {
              goingBack: answeredGoingBack,
              onEdit: () => landing.setEditing(editingKey(answered.id)),
            }
          : {})}
        onStep={takeStep}
      />
    ),
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
        actions={task.actions}
        {...(onOpenPermission ? { onOpenPermission } : {})}
        {...(readPicture ? { readPicture } : {})}
      />
    ),
  };
}
