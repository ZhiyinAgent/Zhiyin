import type {
  RewindCommitResult,
  RewindPreview,
  UndoPreview,
  WorkspaceTask,
} from "@zhiyin/contract";
import type {
  RewindPlan,
  RewindPlanner,
  UndoPlan,
} from "@zhiyin/rewind-planner";
import type {
  FileVersions,
  Recovery,
  RecoveryPreparation,
  RecoveryReview,
} from "@zhiyin/recovery";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

export type PendingRewind = {
  readonly version: 1;
  readonly id: string;
  readonly conversationId: string;
  readonly source: string;
  readonly task: WorkspaceTask;
  readonly review: RecoveryReview;
  readonly result?: RewindCommitResult;
  /**
   * For an undo, what it was planned from, so a restart records it from what
   * the restore found. An entry without it finishes as `task`.
   */
  readonly undo?: { readonly plan: UndoPlan; readonly at: string };
};

export interface RewindJournal {
  pending(): Promise<readonly PendingRewind[]>;
  begin(operation: PendingRewind): Promise<void>;
  filesRestored(id: string, result: RewindCommitResult): Promise<void>;
  complete(id: string): Promise<void>;
}

class MemoryRewindJournal implements RewindJournal {
  readonly #operations = new Map<string, PendingRewind>();
  async pending() {
    return [...this.#operations.values()];
  }
  async begin(operation: PendingRewind) {
    this.#operations.set(operation.id, operation);
  }
  async filesRestored(id: string, result: RewindCommitResult) {
    const operation = this.#operations.get(id);
    if (operation) this.#operations.set(id, { ...operation, result });
  }
  async complete(id: string) {
    this.#operations.delete(id);
  }
}

/**
 * Whether `current` is `rewound` as saved, in everything a rewind changes.
 * Saving records when it happened, and the person may rename the
 * conversation, set its budget or choose its folder while its save waits, so
 * those fields are not compared: the save keeps them as they are now.
 */
function savedAs(current: WorkspaceTask, rewound: WorkspaceTask): boolean {
  const unstamped = (task: WorkspaceTask) =>
    JSON.stringify({
      ...task,
      updatedAt: "",
      updatedLabel: "",
      title: "",
      titleSource: undefined,
      contextBudget: undefined,
      workspace: undefined,
    });
  return unstamped(current) === unstamped(rewound);
}

/**
 * The undo as recorded once the restore has run. A file the review could put
 * back that did not go back, as when another program held it, is tried again
 * at the next undo: the actions that changed it are not recorded as undone.
 */
function recordedUndo(
  planner: RewindPlanner,
  task: WorkspaceTask,
  undo: { readonly plan: UndoPlan; readonly at: string },
  review: RecoveryReview,
  result: RewindCommitResult,
) {
  const retry = new Set(
    review.files
      .filter(
        (file) =>
          file.status === "recoverable" &&
          !result.files.some(
            (done) =>
              done.path === file.path &&
              (done.status === "restored" || done.status === "removed"),
          ),
      )
      .map((file) => file.path),
  );
  return planner.applyUndo(
    task,
    {
      ...undo.plan,
      actions: undo.plan.actions.filter(
        (action) =>
          !action.changes?.some((change) =>
            retry.has(change.path.replaceAll("\\", "/")),
          ),
      ),
    },
    result.files,
    undo.at,
  );
}

function journalKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isPendingRewind(value: unknown): value is PendingRewind {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    item["version"] === 1 &&
    typeof item["id"] === "string" &&
    typeof item["conversationId"] === "string" &&
    typeof item["source"] === "string" &&
    Boolean(item["task"] && typeof item["task"] === "object") &&
    Boolean(item["review"] && typeof item["review"] === "object")
  );
}

/** Replaces a file whole, so a crash leaves the old one or the new. */
export type ReplaceFile = (path: string, text: string) => Promise<void>;

/** Durable intent for the gap between restoring files and saving history. */
export class FileRewindJournal implements RewindJournal {
  readonly #root: string;
  readonly #replace: ReplaceFile;

  constructor(dataDirectory: string, replace: ReplaceFile) {
    this.#root = join(dataDirectory, "pending-rewinds");
    this.#replace = replace;
  }

  async pending(): Promise<readonly PendingRewind[]> {
    let names: string[];
    try {
      names = await readdir(this.#root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const operations = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          try {
            const value: unknown = JSON.parse(
              await readFile(join(this.#root, name), "utf8"),
            );
            return isPendingRewind(value) ? value : undefined;
          } catch {
            return undefined;
          }
        }),
    );
    return operations.filter(
      (operation): operation is PendingRewind => operation !== undefined,
    );
  }

  begin(operation: PendingRewind): Promise<void> {
    return this.#write(operation);
  }

  async filesRestored(id: string, result: RewindCommitResult): Promise<void> {
    const operation = (await this.pending()).find((item) => item.id === id);
    if (!operation) throw new Error("The pending rewind is unavailable.");
    await this.#write({ ...operation, result });
  }

  complete(id: string): Promise<void> {
    return rm(join(this.#root, `${journalKey(id)}.json`), { force: true });
  }

  async #write(operation: PendingRewind): Promise<void> {
    await mkdir(this.#root, { recursive: true });
    await this.#replace(
      join(this.#root, `${journalKey(operation.id)}.json`),
      JSON.stringify(operation),
    );
  }
}

export type RewindMembers = {
  readonly conversation: RewindPlanner;
  readonly recovery: Recovery;
  readonly journal?: RewindJournal;
  /** When an undo is recorded as made. */
  readonly now?: () => Date;
};

/** A copy of what a file change is about to overwrite, taken before approval. */
export type FileBackup = RecoveryPreparation;

/** How the group reads and saves the conversation it is rewinding. */
export type RewindHost = {
  /**
   * Reads a conversation that is not in memory yet. Called before a pending
   * operation found after a restart touches it; every other operation is on a
   * conversation the person has open.
   */
  readonly open?: (conversationId: string) => Promise<void>;
  readonly task: (conversationId: string) => WorkspaceTask;
  readonly save: (task: WorkspaceTask) => Promise<void>;
};

type Refusal = { readonly ok: false; readonly reason: string };

export type RewindPreviewing =
  { readonly ok: true; readonly preview: RewindPreview } | Refusal;

export type UndoPreviewing =
  { readonly ok: true; readonly preview: UndoPreview } | Refusal;

export type RewindCommitting =
  { readonly ok: true; readonly result: RewindCommitResult } | Refusal;

export interface Rewind {
  /** Whether files are being put back for this conversation right now. */
  restoring(conversationId: string): boolean;
  /**
   * Settles once files are no longer being put back for this conversation:
   * at once when they are not, otherwise when the rewind or undo is saved, or
   * the conversation deleted. A write made on no turn's behalf waits for it,
   * so it lands on the conversation as the rewind saved it.
   */
  settled(conversationId: string): Promise<void>;
  /** Finishes durable rewind operations found after a restart. */
  resume(host: RewindHost): Promise<void>;
  /**
   * Lets go of a conversation whose files went back in this session but
   * whose save failed, saving it again once the host holds what was to be
   * saved. Asked before anything new starts in the conversation.
   */
  settle(conversationId: string, host: RewindHost): Promise<void>;
  /**
   * Reviews going back to a message. The review replaces any earlier one for
   * the same conversation, and only the latest can be applied.
   */
  preview(
    conversationId: string,
    messageId: string,
    host: RewindHost,
  ): Promise<RewindPreviewing>;
  /** Applies exactly the reviewed rewind, restoring files only when asked to. */
  commit(
    conversationId: string,
    rewindId: string,
    files: "keep" | "restore",
    host: RewindHost,
  ): Promise<RewindCommitting>;

  /**
   * Reviews putting back the files the turn a message opened changed, keeping
   * the conversation. Replaces any earlier review of an undo for it.
   */
  previewUndo(
    conversationId: string,
    messageId: string,
    host: RewindHost,
  ): Promise<UndoPreviewing>;
  /**
   * Puts back exactly the reviewed files, never one changed since, and records
   * the undo on the conversation.
   */
  commitUndo(
    conversationId: string,
    undoId: string,
    host: RewindHost,
  ): Promise<RewindCommitting>;

  /**
   * A file the turn a message opened changed, as it was before the turn and
   * as the turn left it, or why that cannot be shown.
   */
  versions(
    conversationId: string,
    messageId: string,
    path: string,
    host: RewindHost,
  ): Promise<FileVersions>;

  /** Throws away every backup taken for a deleted conversation. */
  forgetConversation(conversationId: string): Promise<void>;
}

type Pending = { readonly plan: RewindPlan; readonly review?: RecoveryReview };
type PendingUndo = { readonly plan: UndoPlan; readonly review: RecoveryReview };

export class ComposedRewind implements Rewind {
  readonly #members: RewindMembers;
  readonly #journal: RewindJournal;
  readonly #restoring = new Set<string>();
  readonly #blocked = new Set<string>();
  readonly #pending = new Map<string, Pending>();
  readonly #pendingUndos = new Map<string, PendingUndo>();
  /**
   * What each restore of this session found, until its operation is saved:
   * when the journal could not write it down, finishing the operation later
   * still knows it, and the files are not put back a second time.
   */
  readonly #restored = new Map<string, RewindCommitResult>();
  /** What waits, for each conversation, until it is no longer restoring. */
  readonly #waiting = new Map<string, (() => void)[]>();

  constructor(members: RewindMembers) {
    this.#members = members;
    this.#journal = members.journal ?? new MemoryRewindJournal();
  }

  restoring(conversationId: string): boolean {
    return (
      this.#restoring.has(conversationId) || this.#blocked.has(conversationId)
    );
  }

  settled(conversationId: string): Promise<void> {
    if (!this.restoring(conversationId)) return Promise.resolve();
    return new Promise((resolve) => {
      this.#waiting.set(conversationId, [
        ...(this.#waiting.get(conversationId) ?? []),
        resolve,
      ]);
    });
  }

  /** Lets what waits go on, once the conversation is no longer restoring. */
  #letGo(conversationId: string): void {
    if (this.restoring(conversationId)) return;
    const waiting = this.#waiting.get(conversationId) ?? [];
    this.#waiting.delete(conversationId);
    for (const resolve of waiting) resolve();
  }

  /**
   * Finishes each rewind a restart cut short. One that cannot be finished is
   * held, the others still finish, and the first failure is thrown after.
   */
  async resume(host: RewindHost): Promise<void> {
    const failures: unknown[] = [];
    for (const operation of await this.#journal.pending()) {
      this.#restoring.add(operation.conversationId);
      let completed = false;
      try {
        await host.open?.(operation.conversationId);
        const current = host.task(operation.conversationId);
        const finished = (from: WorkspaceTask, result: RewindCommitResult) => {
          if (!operation.undo) return operation.task;
          const recorded = recordedUndo(
            this.#members.conversation,
            from,
            operation.undo,
            operation.review,
            result,
          );
          return recorded.ok ? recorded.task : operation.task;
        };
        if (
          savedAs(current, operation.task) ||
          (operation.result &&
            savedAs(
              current,
              finished(
                JSON.parse(operation.source) as WorkspaceTask,
                operation.result,
              ),
            ))
        ) {
          await this.#journal.complete(operation.id);
          completed = true;
          continue;
        }
        if (JSON.stringify(current) !== operation.source)
          throw new Error(
            "A pending rewind no longer matches the saved conversation.",
          );
        const result =
          operation.result ??
          (await this.#members.recovery.restore(operation.review));
        if (!operation.result)
          await this.#journal.filesRestored(operation.id, result);
        await host.save(finished(current, result));
        await this.#journal.complete(operation.id);
        completed = true;
      } catch (error) {
        failures.push(error);
      } finally {
        this.#restoring.delete(operation.conversationId);
        if (completed) this.#blocked.delete(operation.conversationId);
        else this.#blocked.add(operation.conversationId);
        this.#letGo(operation.conversationId);
      }
    }
    if (failures.length) throw failures[0];
  }

  async settle(conversationId: string, host: RewindHost): Promise<void> {
    if (this.#restoring.has(conversationId)) return;
    if (!this.#blocked.has(conversationId)) return;
    for (const operation of await this.#journal.pending())
      if (
        operation.conversationId === conversationId &&
        (await this.#finished(conversationId, operation.id, host))
      )
        return;
  }

  async preview(
    conversationId: string,
    messageId: string,
    host: RewindHost,
  ): Promise<RewindPreviewing> {
    await this.settle(conversationId, host);
    if (this.restoring(conversationId))
      return {
        ok: false,
        reason:
          "Wait for file recovery to finish before starting another turn.",
      };
    const task = host.task(conversationId);
    const planned = this.#members.conversation.plan(task, messageId);
    if (!planned.ok) return planned;
    const workspaceRoot = task.workspace?.path;
    const review = workspaceRoot
      ? await this.#members.recovery.review(
          planned.preview.id,
          workspaceRoot,
          planned.preview.discardedActions,
        )
      : undefined;
    const preview = { ...planned.preview, files: review?.files ?? [] };
    for (const [id, pending] of this.#pending)
      if (pending.plan.preview.taskId === conversationId)
        this.#pending.delete(id);
    this.#pending.set(preview.id, {
      plan: { ...planned, preview },
      ...(review ? { review } : {}),
    });
    return { ok: true, preview };
  }

  /**
   * Finishes an operation of this session whose files went back but which
   * was not saved: when the host holds what it was to save, or still holds
   * the conversation as it was before, the file results are written down if
   * the journal lacks them, the save is made, the journal entry cleared and
   * the conversation let go.
   */
  async #finished(
    conversationId: string,
    id: string,
    host: RewindHost,
  ): Promise<RewindCommitting | undefined> {
    if (!this.#blocked.has(conversationId)) return undefined;
    const operation = (await this.#journal.pending()).find(
      (item) => item.id === id && item.conversationId === conversationId,
    );
    const result = operation?.result ?? this.#restored.get(id);
    if (!operation || !result) return undefined;
    const current = host.task(conversationId);
    const intended = operation.undo
      ? recordedUndo(
          this.#members.conversation,
          JSON.parse(operation.source) as WorkspaceTask,
          operation.undo,
          operation.review,
          result,
        )
      : { ok: true as const, task: operation.task };
    if (!intended.ok) return undefined;
    const before = JSON.stringify(current) === operation.source;
    if (!before && !savedAs(current, intended.task)) return undefined;
    this.#restoring.add(conversationId);
    try {
      if (!operation.result) await this.#journal.filesRestored(id, result);
      await host.save(before ? intended.task : current);
      await this.#journal.complete(id);
      this.#blocked.delete(conversationId);
      this.#pending.delete(id);
      this.#pendingUndos.delete(id);
      this.#restored.delete(id);
      return { ok: true, result };
    } finally {
      this.#restoring.delete(conversationId);
      this.#letGo(conversationId);
    }
  }

  async commit(
    conversationId: string,
    rewindId: string,
    files: "keep" | "restore",
    host: RewindHost,
  ): Promise<RewindCommitting> {
    if (this.#restoring.has(conversationId))
      return { ok: false, reason: "That rewind is already being applied." };
    const finished = await this.#finished(conversationId, rewindId, host);
    if (finished) return finished;
    const pending = this.#pending.get(rewindId);
    if (!pending || pending.plan.preview.taskId !== conversationId)
      return {
        ok: false,
        reason: "That rewind is no longer active. Review the message again.",
      };
    const applied = this.#members.conversation.apply(
      host.task(conversationId),
      pending.plan,
    );
    if (!applied.ok) {
      this.#pending.delete(rewindId);
      return applied;
    }
    const result = await this.#restoreAndSave(
      conversationId,
      rewindId,
      files === "restore" && pending.review
        ? {
            version: 1,
            id: rewindId,
            conversationId,
            source: pending.plan.source,
            task: applied.task,
            review: pending.review,
          }
        : undefined,
      host,
      () => applied.task,
    );
    this.#pending.delete(rewindId);
    return { ok: true, result };
  }

  /**
   * Puts back the files `entry` reviewed, through the journal, and saves the
   * conversation as `saved` makes it from what the restore found. The entry
   * is written before any file is touched, what the restore found before the
   * save, and the entry is cleared once saved; should a step after the entry
   * fail, the conversation stays blocked until the operation is finished.
   * Without an entry no file is touched, and the conversation is only saved.
   */
  async #restoreAndSave(
    conversationId: string,
    id: string,
    entry: PendingRewind | undefined,
    host: RewindHost,
    saved: (result: RewindCommitResult) => WorkspaceTask,
  ): Promise<RewindCommitResult> {
    this.#restoring.add(conversationId);
    let durableIntent = false;
    try {
      let result: RewindCommitResult = { files: [] };
      if (entry) {
        await this.#journal.begin(entry);
        durableIntent = true;
        result = await this.#members.recovery.restore(entry.review);
        this.#restored.set(id, result);
        await this.#journal.filesRestored(id, result);
      }
      await host.save(saved(result));
      if (entry) await this.#journal.complete(id);
      this.#blocked.delete(conversationId);
      this.#restored.delete(id);
      return result;
    } catch (error) {
      if (durableIntent) this.#blocked.add(conversationId);
      throw error;
    } finally {
      this.#restoring.delete(conversationId);
      this.#letGo(conversationId);
    }
  }

  async previewUndo(
    conversationId: string,
    messageId: string,
    host: RewindHost,
  ): Promise<UndoPreviewing> {
    await this.settle(conversationId, host);
    if (this.restoring(conversationId))
      return {
        ok: false,
        reason:
          "Wait for file recovery to finish before undoing anything else.",
      };
    const task = host.task(conversationId);
    const workspaceRoot = task.workspace?.path;
    if (!workspaceRoot)
      return {
        ok: false,
        reason:
          "This conversation has no folder, so it has no files to put back.",
      };
    const planned = this.#members.conversation.planUndo(task, messageId);
    if (!planned.ok) return planned;
    const review = await this.#members.recovery.review(
      planned.id,
      workspaceRoot,
      planned.actions,
    );
    if (review.folderUnavailable)
      return {
        ok: false,
        reason: `This conversation's folder, ${workspaceRoot}, could not be opened, so its files cannot be put back.`,
      };
    for (const [id, pending] of this.#pendingUndos)
      if (pending.plan.taskId === conversationId) this.#pendingUndos.delete(id);
    this.#pendingUndos.set(planned.id, { plan: planned, review });
    return {
      ok: true,
      preview: {
        id: planned.id,
        taskId: conversationId,
        messageId,
        files: review.files,
      },
    };
  }

  async versions(
    conversationId: string,
    messageId: string,
    path: string,
    host: RewindHost,
  ): Promise<FileVersions> {
    const task = host.task(conversationId);
    const workspaceRoot = task.workspace?.path;
    if (!workspaceRoot)
      return { ok: false, reason: "This conversation has no folder." };
    const planned = this.#members.conversation.planUndo(task, messageId);
    if (!planned.ok) return planned;
    return this.#members.recovery.versions(
      workspaceRoot,
      planned.actions,
      path,
    );
  }

  async commitUndo(
    conversationId: string,
    undoId: string,
    host: RewindHost,
  ): Promise<RewindCommitting> {
    if (this.#restoring.has(conversationId))
      return { ok: false, reason: "Files are already being put back." };
    const finished = await this.#finished(conversationId, undoId, host);
    if (finished) return finished;
    if (this.#blocked.has(conversationId))
      return {
        ok: false,
        reason:
          "Wait for file recovery to finish before undoing anything else.",
      };
    const pending = this.#pendingUndos.get(undoId);
    if (!pending || pending.plan.taskId !== conversationId)
      return {
        ok: false,
        reason: "That undo is no longer active. Review the turn again.",
      };
    const at = (this.#members.now?.() ?? new Date()).toISOString();
    const task = host.task(conversationId);
    // What the conversation becomes if the files go back as reviewed: the
    // record a restart finishes with, should it come between the two.
    const intended = this.#members.conversation.applyUndo(
      task,
      pending.plan,
      pending.review.files.map((file) => ({
        path: file.path,
        status:
          file.status === "recoverable"
            ? file.action === "remove"
              ? ("removed" as const)
              : ("restored" as const)
            : file.status,
        ...(file.reason ? { reason: file.reason } : {}),
      })),
      at,
    );
    if (!intended.ok) {
      this.#pendingUndos.delete(undoId);
      return intended;
    }
    const result = await this.#restoreAndSave(
      conversationId,
      undoId,
      {
        version: 1,
        id: undoId,
        conversationId,
        source: pending.plan.source,
        task: intended.task,
        review: pending.review,
        undo: { plan: pending.plan, at },
      },
      host,
      (restored) => {
        const recorded = recordedUndo(
          this.#members.conversation,
          task,
          { plan: pending.plan, at },
          pending.review,
          restored,
        );
        return recorded.ok ? recorded.task : intended.task;
      },
    );
    this.#pendingUndos.delete(undoId);
    return { ok: true, result };
  }

  /**
   * A deleted conversation's copies go, and so does a rewind or undo it left
   * unfinished: there is no conversation left to finish it in.
   */
  async forgetConversation(conversationId: string): Promise<void> {
    if (!this.#restoring.has(conversationId)) {
      for (const operation of await this.#journal.pending())
        if (operation.conversationId === conversationId) {
          await this.#journal.complete(operation.id);
          this.#restored.delete(operation.id);
        }
      this.#blocked.delete(conversationId);
      this.#letGo(conversationId);
    }
    await this.#members.recovery.forgetConversation(conversationId);
  }
}
