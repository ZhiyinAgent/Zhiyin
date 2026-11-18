import {
  ActionHistory,
  SpecialistRunHistory,
  TurnChecks,
  TurnFiles,
  touchesFiles,
  turnChecks,
} from "../actions/index.js";
import { TurnMemory } from "../memory/index.js";
import { MarkdownMessage, type TimelinePieces } from "../conversation/index.js";
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
} from "./windowState.js";
import type { WindowCommands } from "./windowCommands.js";
import { reasonOf } from "./useCommandRunner.js";
import { answeredMessage } from "./turns.js";
import {
  type MessageAttachment,
  type ProviderSettings,
  type RewindCommitResult,
} from "@zhiyin/contract";
import { actionsOfTurn } from "@zhiyin/conversation-rules";

/**
 * What the shell does for a piece: tell, fill the composer, open the Model
 * page, and hold which of the person's messages is open for editing.
 */
type RewindLanding = {
  /** The message open for editing, as `taskId:messageId`. */
  editing?: string | undefined;
  setEditing(key: string | undefined): void;
  say(message: string): void;
  /** The Model page, at the key dialog or the model list. */
  openModel(opening: "apiKey" | "model"): void;
  /** The Memory page, at one entry. */
  openMemoryEntry(number: number): void;
  /** Who requests go to, whose billing page adding credits opens. */
  provider?: ProviderSettings["provider"];
  /** No key is saved for it, so the key is added rather than updated. */
  keyMissing?: boolean;
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
  commands: WindowCommands,
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
        `Went back. ${unresolved.length} ${unresolved.length === 1 ? "file was" : "files were"} left unchanged because recovery was unavailable or unsafe.`,
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
    if (step === "updateApiKey") landing.openModel("apiKey");
    else if (step === "addCredits" && landing.provider)
      void commands
        .openExternalUrl(landing.provider.pages.billing)
        .catch((cause: unknown) =>
          landing.say(reasonOf(cause, "The billing page could not be opened.")),
        );
    else if (step === "continue")
      void commands
        .sendMessage(task.id, "Continue.", task.reasoning)
        .catch((cause: unknown) =>
          landing.say(
            reasonOf(cause, "The conversation could not continue. Try again."),
          ),
        );
    else landing.openModel("model");
  }
  const answered = answeredMessage(task);
  const answeredGoingBack = answered && goingBackTo(answered);
  return {
    openAttachment: (id) =>
      void commands
        .openAttachment(task.id, id)
        .catch((cause: unknown) =>
          landing.say(reasonOf(cause, "The attachment could not be opened.")),
        ),
    ...(readPicture ? { readPicture } : {}),
    answerNow: () => commands.answerNow(task.id),
    waitingMessage: {
      sendNow: () => commands.sendNow(task.id),
      takeBack: (messageId) => commands.takeBackMessage(task.id, messageId),
    },
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
      const actions = actionsOfTurn(task, opening.id) ?? [];
      // Decided here, not inside the summary: the conversation draws a
      // response around whatever this returns, and an element that renders
      // nothing would still leave Zhiyin's mark on an empty row.
      if (running) return null;
      const memory = actions.flatMap((action) =>
        action.memory
          ? [
              action.lookBack
                ? { ...action.memory, afterTurn: true as const }
                : action.memory,
            ]
          : [],
      );
      const files = touchesFiles(actions);
      const checks = turnChecks(actions);
      if (!files && memory.length === 0 && checks.length === 0) return null;
      const undone = task.undos.find((undo) => undo.messageId === opening.id);
      return (
        <>
          {checks.length > 0 && <TurnChecks checks={checks} />}
          {files && (
            <TurnFiles
              actions={actions}
              running={running}
              undone={undone}
              {...(previewUndo && commitUndo
                ? {
                    onPreviewUndo: () => previewUndo(task.id, opening.id),
                    onCommitUndo: (undoId: string) =>
                      commitUndo(task.id, undoId),
                  }
                : {})}
              onCompareDocument={
                compareDocument &&
                ((path: string) => compareDocument(task.id, opening.id, path))
              }
            />
          )}
          {memory.length > 0 && (
            <TurnMemory
              changes={memory}
              onOpen={landing.openMemoryEntry}
              onChange={(request) => commands.changeMemory(request)}
            />
          )}
        </>
      );
    },
    failure: (remedies) => (
      <FailedTurnActions
        remedies={
          // Credits are added on a provider's own billing page; with none
          // known, there is nowhere to send the person.
          landing.provider
            ? remedies
            : remedies.filter((remedy) => remedy !== "addCredits")
        }
        providerName={landing.provider?.name}
        keyMissing={landing.keyMissing === true}
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
        onOpenPermission={onOpenPermission}
        readPicture={readPicture}
      />
    ),
    view: (view: TaskView) => (
      <TaskViewCard
        view={view}
        onSave={
          exportView && ((svg: string) => exportView(task.id, view.id, svg))
        }
      />
    ),
    interaction: (interaction: TaskInteraction) => (
      <InteractionCard interaction={interaction} />
    ),
    specialistRun: (run: SpecialistRun) => (
      <SpecialistRunHistory
        run={run}
        actions={task.actions}
        Markdown={MarkdownMessage}
        onOpenPermission={onOpenPermission}
        readPicture={readPicture}
      />
    ),
  };
}
