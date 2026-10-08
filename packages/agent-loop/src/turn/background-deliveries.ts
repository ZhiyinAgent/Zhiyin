import type { TaskUndo, WorkspaceTask } from "@zhiyin/contract";
import type { Sessions } from "@zhiyin/session";
import { specialistRunsText } from "../context/conversation-context.js";
import type { ModelHistory } from "../context/model-history.js";
import type { PendingHandoffs } from "../specialist/pending-handoffs.js";
import { deliverPendingHandoffs } from "../specialist/specialist-handoff-delivery.js";
import type { CommandEndings } from "../tools/command-endings.js";
import { harnessNotice } from "./notices.js";
import type { TurnRecords } from "./turn-records.js";

/** What became of each file of an undone turn, in the words the model reads. */
function undoText(task: WorkspaceTask, undo: TaskUndo): string {
  const asked = task.messages.find((message) => message.id === undo.messageId);
  const paths = (status: TaskUndo["files"][number]["status"]) =>
    undo.files
      .filter((file) => file.status === status)
      .map((file) => file.path)
      .join(", ");
  const lines = [
    `The person undid the file changes of an earlier turn${asked ? `, the one answering "${asked.text}"` : ""}. The conversation is unchanged; the files are not.`,
  ];
  const restored = paths("restored");
  const removed = paths("removed");
  const conflicted = paths("conflict");
  const unprotected = paths("unprotected");
  if (restored)
    lines.push(`Put back as they were before that turn: ${restored}.`);
  if (removed) lines.push(`Created by that turn and now removed: ${removed}.`);
  if (conflicted)
    lines.push(`Left as they are, because they changed since: ${conflicted}.`);
  if (unprotected)
    lines.push(`Not put back, because no copy was kept: ${unprotected}.`);
  lines.push(
    "Read a file again before relying on it, and do not redo these changes unless asked.",
  );
  return lines.join("\n");
}

/**
 * What changed in the background since the model last heard: its specialists'
 * state when it changed, their handoffs, its commands that ended, and files
 * the person put back. Told before each request, so a turn hears of each as
 * soon as it next asks.
 */
export async function deliverBackgroundWork(
  taskId: string,
  history: ModelHistory,
  from: {
    readonly records: TurnRecords;
    readonly pendingHandoffs: PendingHandoffs;
    readonly commandEndings: CommandEndings;
    readonly sessions: Sessions;
  },
): Promise<void> {
  const runs = specialistRunsText(from.records.task(taskId).specialistRuns);
  if (
    runs &&
    history.latestNotice("specialists") !== harnessNotice("specialists", runs)
  )
    await history.notice("specialists", runs);
  await deliverPendingHandoffs(
    taskId,
    from.pendingHandoffs,
    from.records,
    from.sessions,
    history,
  );
  for (const ending of from.commandEndings.drain(taskId))
    await history.notice("job", ending);
  const task = from.records.task(taskId);
  const untold = task.undos.filter((undo) => !undo.told);
  if (!untold.length) return;
  for (const undo of untold) await history.notice("undo", undoText(task, undo));
  const latest = from.records.task(taskId);
  await from.records.replaceTask({
    ...latest,
    undos: latest.undos.map((undo) =>
      untold.some((item) => item.id === undo.id)
        ? { ...undo, told: true as const }
        : undo,
    ),
  });
}
