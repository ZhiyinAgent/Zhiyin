import type { MemoryRuleChange } from "./memory.js";
import type { TaskAction } from "./task-action.js";

export type RewindPreview = {
  readonly id: string;
  readonly taskId: string;
  readonly messageId: string;
  readonly draft: string;
  readonly discardedMessages: number;
  /** Messages the person wrote after the selected one, answers included. */
  readonly laterUserMessages: number;
  readonly discardedActions: readonly TaskAction[];
  readonly files: readonly RewindFileEffect[];
  /** What the discarded turns kept in memory, newest first. */
  readonly memory: readonly RewindMemoryEffect[];
};

export type RewindFileEffect = {
  readonly path: string;
  readonly action: "restore" | "remove" | "unknown";
  readonly status: "recoverable" | "conflict" | "unprotected";
  readonly reason?: string;
};

/**
 * One memory write of the turns a rewind or an undo takes back, and what
 * undoing memory changes would do to it: take it back, or leave it, because
 * the person already kept or discarded it (`decided`), or because memory
 * would refuse it now (`changed`), as when the entry changed since.
 */
export type RewindMemoryEffect = {
  readonly writeId: string;
  /** The entry's number, once it exists. */
  readonly number?: number;
  readonly title: string;
  /** For a change to About you or How to work, the one rule it changed. */
  readonly rule?: MemoryRuleChange;
  readonly status: "undoable" | "decided" | "changed";
  /** Why memory would refuse it, for `changed`. */
  readonly reason?: string;
};

/** What became of each memory write a rewind or an undo took back or left. */
export type RewindMemoryOutcome = {
  readonly writeId: string;
  readonly number?: number;
  readonly title: string;
  /** For a change to About you or How to work, the one rule it changed. */
  readonly rule?: MemoryRuleChange;
  readonly status: "undone" | "kept" | "refused";
  /** Why memory refused it, for `refused`. */
  readonly reason?: string;
};

/**
 * Putting back the files one turn changed, keeping the conversation. Reviewed
 * before anything is restored, as a rewind is.
 */
export type UndoPreview = {
  readonly id: string;
  readonly taskId: string;
  /** The person's message that opened the turn. */
  readonly messageId: string;
  readonly files: readonly RewindFileEffect[];
  /** What the turn kept in memory, newest first. */
  readonly memory: readonly RewindMemoryEffect[];
};

/**
 * A PDF one turn changed, as the words of each page before the turn and as the
 * turn left it, for the person to see what the change did.
 */
export type DocumentComparison = {
  /** Absent when the turn created the document. */
  readonly before?: readonly string[];
  readonly after: readonly string[];
};

export type RewindCommitResult = {
  readonly files: readonly {
    readonly path: string;
    readonly status: "restored" | "removed" | "conflict" | "unprotected";
    readonly reason?: string;
  }[];
  /** Each memory write the operation took back or left, newest first. */
  readonly memory?: readonly RewindMemoryOutcome[];
};

/**
 * A turn whose changes the person undid, and what became of each file and of
 * each memory write.
 */
export type TaskUndo = {
  readonly id: string;
  readonly messageId: string;
  /** The actions whose file changes were undone; none when files were kept. */
  readonly actionIds: readonly string[];
  readonly at: string;
  readonly files: RewindCommitResult["files"];
  readonly memory?: RewindCommitResult["memory"];
  /**
   * Where the person took memory back, when not with the turn's Undo: one
   * row's Undo on the turn's memory card, or removing the entry on the Memory
   * page; or, `memoryPageBack`, that they put back there an entry whose
   * removal the model was told of. Nothing else of the turn is undone.
   */
  readonly memoryFrom?: "card" | "memoryPage" | "memoryPageBack";
  /** Set once the model has been told. */
  readonly told?: true;
};

/** What the window asks of the core to go back or undo a turn. */
export interface RewindCommands {
  /** Review the exact conversation revision before discarding anything. */
  previewRewind(taskId: string, messageId: string): Promise<RewindPreview>;

  /**
   * Apply only the still-current rewind previously returned by previewRewind,
   * putting files back and taking back what the discarded turns kept in
   * memory, each only when asked to.
   */
  commitRewind(
    taskId: string,
    rewindId: string,
    files: "keep" | "restore",
    memory: "keep" | "undo",
  ): Promise<RewindCommitResult>;

  /**
   * Review undoing what one turn changed, its files and what it kept in
   * memory, keeping the conversation.
   */
  previewUndo(taskId: string, messageId: string): Promise<UndoPreview>;

  /**
   * Undo exactly the reviewed changes, each kind only when asked to: files,
   * never one changed since, and what the turn kept in memory.
   */
  commitUndo(
    taskId: string,
    undoId: string,
    files: "keep" | "restore",
    memory: "keep" | "undo",
  ): Promise<RewindCommitResult>;

  /**
   * What one turn changed in a PDF, as its words before and after. Refused
   * when no copy was kept before the turn or the PDF has changed since.
   */
  compareDocument(
    taskId: string,
    messageId: string,
    path: string,
  ): Promise<DocumentComparison>;
}
