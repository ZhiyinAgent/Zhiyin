import type { TaskUndo, WorkspaceTask } from "@zhiyin/contract";
import type { KeptStore } from "@zhiyin/session";
import { specialistRunsText } from "../context/conversation-context.js";
import type { ModelHistory } from "../context/model-history.js";
import type { PendingHandoffs } from "../specialist/pending-handoffs.js";
import { deliverPendingHandoffs } from "../specialist/specialist-handoff-delivery.js";
import type { CommandEndings } from "../tools/command-endings.js";
import { harnessNotice } from "./notices.js";
import type { TurnRecords } from "./turn-records.js";

type MemoryWrite = NonNullable<TaskUndo["memory"]>[number];

/**
 * A memory write as the model reads it: an entry by its number and title, a
 * change to About you or How to work by the one rule it changed, so the rest
 * of that instruction is not taken for gone. `taken`: the write was taken
 * back, so a rule it replaced or removed is there again.
 */
function writeName(write: MemoryWrite, taken: boolean): string {
  const { rule } = write;
  if (rule?.added !== undefined && rule.replaced !== undefined)
    return taken
      ? `the rule “${rule.added}” in ${write.title}, which reads “${rule.replaced}” again`
      : `the rule “${rule.added}” in ${write.title}, in place of “${rule.replaced}”`;
  if (rule?.added !== undefined)
    return `the rule “${rule.added}” in ${write.title}`;
  if (rule?.replaced !== undefined)
    return taken
      ? `the removal of the rule “${rule.replaced}” from ${write.title}, which is there again`
      : `the removal of the rule “${rule.replaced}” from ${write.title}`;
  return write.number === undefined
    ? write.title
    : `#${write.number} ${write.title}`;
}

/** That the rest of each instruction a rule was taken back from stays; nothing when none was. */
function restStays(writes: readonly MemoryWrite[]): string | undefined {
  const titles = [
    ...new Set(writes.flatMap((write) => (write.rule ? [write.title] : []))),
  ];
  return titles.length
    ? `The rest of ${titles.join(" and ")} stays as it is.`
    : undefined;
}

/**
 * What the person took back from memory alone, on a turn's memory card or on
 * the Memory page, in the words the model reads.
 */
function memoryTakenText(
  answering: string,
  undo: TaskUndo,
  from: NonNullable<TaskUndo["memoryFrom"]>,
): string {
  const writes = undo.memory ?? [];
  const named = writes.map((write) => writeName(write, true)).join(", ");
  if (from === "memoryPageBack")
    return [
      `The person put back, on the Memory page, what they had removed from memory and an earlier turn kept${answering}.`,
      `Kept in memory again: ${named}. Rely on it as before.`,
    ].join("\n");
  const rest = restStays(writes);
  return [
    from === "card"
      ? `The person undid, on its memory card, what an earlier turn kept in memory${answering}. The conversation stays as it is, but this is no longer in memory.`
      : `The person removed from memory, on the Memory page, what an earlier turn kept${answering}. The conversation stays as it is, but this is no longer in memory.`,
    from === "card"
      ? `Taken back from memory, so no longer kept: ${named}.`
      : `No longer kept: ${named}.`,
    ...(rest ? [rest] : []),
    "Do not say it is still in memory, and do not keep it again unless asked.",
  ].join("\n");
}

/**
 * What became of each file and each memory entry of an undone turn, in the
 * words the model reads.
 */
function undoText(task: WorkspaceTask, undo: TaskUndo): string {
  const asked = task.messages.find((message) => message.id === undo.messageId);
  if (undo.memoryFrom)
    return memoryTakenText(
      asked ? `, the one answering "${asked.text}"` : "",
      undo,
      undo.memoryFrom,
    );
  const paths = (status: TaskUndo["files"][number]["status"]) =>
    undo.files
      .filter((file) => file.status === status)
      .map((file) => file.path)
      .join(", ");
  const memory = undo.memory ?? [];
  const undone = memory.filter((write) => write.status === "undone");
  const takenBack = undone.map((write) => writeName(write, true)).join(", ");
  const stillKept = memory
    .filter((write) => write.status !== "undone")
    .map((write) => writeName(write, false))
    .join(", ");
  const rest = restStays(undone);
  const files = undo.actionIds.length > 0 || undo.files.length > 0;
  const undid = [
    ...(files ? ["the file changes"] : []),
    ...(takenBack ? ["what it kept in memory"] : []),
  ].join(" and ");
  const after = takenBack
    ? " Its messages stay, but what its remember calls kept is changed as below."
    : files
      ? " The conversation is unchanged; the files are not."
      : " Nothing it kept could be taken back.";
  const lines = [
    `The person undid ${undid || "what it kept in memory"} of an earlier turn${asked ? `, the one answering "${asked.text}"` : ""}.${after}`,
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
  if (takenBack)
    lines.push(`Taken back from memory, so no longer kept: ${takenBack}.`);
  if (rest) lines.push(rest);
  if (stillKept) lines.push(`Still kept in memory as it is now: ${stillKept}.`);
  if (files)
    lines.push(
      "Read a file again before relying on it, and do not redo these changes unless asked.",
    );
  if (takenBack)
    lines.push(
      "Do not say what was taken back is still in memory, and do not keep it again unless asked.",
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
    readonly kept: KeptStore;
    /** The turn's stop: what it could not tell waits for the next turn. */
    readonly signal?: AbortSignal;
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
    from.kept,
    history,
    from.signal,
  );
  const endings = from.commandEndings.drain(taskId);
  for (const [at, ending] of endings.entries()) {
    await history.notice("job", ending);
    // A stop while it was told may have kept it out: it and the rest are
    // told at the next turn the person starts, each once.
    if (from.signal?.aborted) {
      const content = harnessNotice("job", ending);
      const told = from.records
        .task(taskId)
        .modelHistory.some(
          (entry) => entry.kind === "notice" && entry.content === content,
        );
      for (const untold of endings.slice(told ? at + 1 : at))
        from.commandEndings.push(taskId, untold, false);
      from.signal.throwIfAborted();
    }
  }
  const task = from.records.task(taskId);
  // An undo is told until its notice is among what the model was sent: a
  // rewind that cut the notice has it told again.
  const sent = new Set(
    task.modelHistory.flatMap((entry) =>
      entry.kind === "notice" ? [entry.content] : [],
    ),
  );
  const untold = task.undos.filter(
    (undo) =>
      !undo.told || !sent.has(harnessNotice("undo", undoText(task, undo))),
  );
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
