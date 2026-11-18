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
};

export type RewindFileEffect = {
  readonly path: string;
  readonly action: "restore" | "remove" | "unknown";
  readonly status: "recoverable" | "conflict" | "unprotected";
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
};

/** A turn whose file changes the person undid, and what became of each file. */
export type TaskUndo = {
  readonly id: string;
  readonly messageId: string;
  readonly actionIds: readonly string[];
  readonly at: string;
  readonly files: RewindCommitResult["files"];
  /** Set once the model has been told. */
  readonly told?: true;
};
