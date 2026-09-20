/**
 * Going back to an earlier message, together with the files the conversation
 * changed since.
 *
 * The conversation planner decides what a rewind removes; file recovery keeps
 * copies of what file changes overwrote and puts them back. This group joins
 * the two: it binds a plan to its file review, keeps that pair until it is
 * applied or replaced, says when files are being put back, and takes the
 * backups around each file change. Each member keeps its own rules and storage
 * (ADR 0034).
 *
 * Boundaries and invariants: docs/architecture/features/rewind/README.md
 */

import type {
  FileChange,
  RewindCommitResult,
  RewindPreview,
  WorkspaceTask,
} from "@zhiyin/contract";
import type { RewindPlan, RewindPlanner } from "@zhiyin/conversation-rewind";
import type {
  Recovery,
  RecoveryPreparation,
  RecoveryReview,
  RecoveryStorage,
} from "@zhiyin/recovery";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export type PendingRewind = {
  readonly version: 1;
  readonly id: string;
  readonly conversationId: string;
  readonly source: string;
  readonly task: WorkspaceTask;
  readonly review: RecoveryReview;
  readonly result?: RewindCommitResult;
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

/** Durable intent for the gap between restoring files and saving history. */
export class FileRewindJournal implements RewindJournal {
  readonly #root: string;

  constructor(dataDirectory: string) {
    this.#root = join(dataDirectory, "pending-rewinds");
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
    const destination = join(this.#root, `${journalKey(operation.id)}.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(operation), "utf8");
    await rename(temporary, destination);
  }
}

export type RewindMembers = {
  readonly conversation: RewindPlanner;
  readonly recovery: Recovery;
  readonly journal?: RewindJournal;
};

/** A copy of what a file change is about to overwrite, taken before approval. */
export type FileBackup = RecoveryPreparation;

/** How the group reads and saves the conversation it is rewinding. */
export type RewindHost = {
  readonly task: (conversationId: string) => WorkspaceTask;
  readonly save: (task: WorkspaceTask) => Promise<void>;
};

type Refusal = { readonly ok: false; readonly reason: string };

export type RewindPreviewing =
  { readonly ok: true; readonly preview: RewindPreview } | Refusal;

export type RewindCommitting =
  { readonly ok: true; readonly result: RewindCommitResult } | Refusal;

export interface Rewind {
  /** Whether files are being put back for this conversation right now. */
  restoring(conversationId: string): boolean;
  /** Finishes durable rewind operations found after a restart. */
  resume(host: RewindHost): Promise<void>;
  recoveryStorage(): Promise<RecoveryStorage>;
  clearRecovery(): Promise<void>;
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

  /** Takes a copy of what a declared file change would overwrite. */
  backUp(
    actionId: string,
    workspaceRoot: string | undefined,
    changes: readonly FileChange[],
  ): Promise<FileBackup>;
  /** Whether the files a backup protects are still what was copied. */
  checkBackup(actionId: string): Promise<{ readonly ok: true } | Refusal>;
  /** Records what the change left behind, once it has run. */
  completeBackup(actionId: string): Promise<void>;
  /** Throws away the backup of a change that did not run. */
  discardBackup(actionId: string): Promise<void>;
}

type Pending = { readonly plan: RewindPlan; readonly review?: RecoveryReview };

export class ComposedRewind implements Rewind {
  readonly #members: RewindMembers;
  readonly #journal: RewindJournal;
  readonly #restoring = new Set<string>();
  readonly #blocked = new Set<string>();
  readonly #pending = new Map<string, Pending>();

  constructor(members: RewindMembers) {
    this.#members = members;
    this.#journal = members.journal ?? new MemoryRewindJournal();
  }

  restoring(conversationId: string): boolean {
    return (
      this.#restoring.has(conversationId) || this.#blocked.has(conversationId)
    );
  }

  async resume(host: RewindHost): Promise<void> {
    for (const operation of await this.#journal.pending()) {
      this.#restoring.add(operation.conversationId);
      let completed = false;
      try {
        const current = host.task(operation.conversationId);
        if (JSON.stringify(current) === JSON.stringify(operation.task)) {
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
        await host.save(operation.task);
        await this.#journal.complete(operation.id);
        completed = true;
      } finally {
        this.#restoring.delete(operation.conversationId);
        if (completed) this.#blocked.delete(operation.conversationId);
        else this.#blocked.add(operation.conversationId);
      }
    }
  }

  recoveryStorage(): Promise<RecoveryStorage> {
    return this.#members.recovery.storage();
  }

  async clearRecovery(): Promise<void> {
    if (this.#restoring.size || (await this.#journal.pending()).length)
      throw new Error(
        "Recovery data cannot be deleted while a rewind is unfinished.",
      );
    await this.#members.recovery.clear();
    for (const [id, pending] of this.#pending) {
      if (!pending.review) continue;
      const files = pending.review.files.map((file) =>
        file.status === "recoverable"
          ? {
              ...file,
              status: "unprotected" as const,
              reason: "The retained recovery data was deleted.",
            }
          : file,
      );
      this.#pending.set(id, {
        plan: {
          ...pending.plan,
          preview: { ...pending.plan.preview, files },
        },
        review: { ...pending.review, files, targets: [] },
      });
    }
  }

  async preview(
    conversationId: string,
    messageId: string,
    host: RewindHost,
  ): Promise<RewindPreviewing> {
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

  async commit(
    conversationId: string,
    rewindId: string,
    files: "keep" | "restore",
    host: RewindHost,
  ): Promise<RewindCommitting> {
    if (this.#restoring.has(conversationId))
      return { ok: false, reason: "That rewind is already being applied." };
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
    this.#restoring.add(conversationId);
    let durableIntent = false;
    try {
      let result: RewindCommitResult = { files: [] };
      if (files === "restore" && pending.review) {
        await this.#journal.begin({
          version: 1,
          id: rewindId,
          conversationId,
          source: pending.plan.source,
          task: applied.task,
          review: pending.review,
        });
        durableIntent = true;
        result = await this.#members.recovery.restore(pending.review);
        await this.#journal.filesRestored(rewindId, result);
      }
      await host.save(applied.task);
      if (files === "restore" && pending.review)
        await this.#journal.complete(rewindId);
      this.#blocked.delete(conversationId);
      this.#pending.delete(rewindId);
      return { ok: true, result };
    } catch (error) {
      if (durableIntent) this.#blocked.add(conversationId);
      throw error;
    } finally {
      this.#restoring.delete(conversationId);
    }
  }

  async backUp(
    actionId: string,
    workspaceRoot: string | undefined,
    changes: readonly FileChange[],
  ): Promise<FileBackup> {
    const unprotected = (reason: string): FileBackup => ({
      actionId,
      files: changes.map((change) => ({
        path: change.path,
        status: "unprotected" as const,
        reason,
      })),
    });
    if (!workspaceRoot)
      return unprotected("No workspace was available for recovery.");
    return this.#members.recovery
      .prepare(actionId, workspaceRoot, changes)
      .catch(() =>
        unprotected("Recovery storage was unavailable before this action."),
      );
  }

  checkBackup(actionId: string): Promise<{ readonly ok: true } | Refusal> {
    return this.#members.recovery.validate(actionId);
  }

  completeBackup(actionId: string): Promise<void> {
    return this.#members.recovery.commit(actionId);
  }

  discardBackup(actionId: string): Promise<void> {
    return this.#members.recovery.discard(actionId);
  }
}
