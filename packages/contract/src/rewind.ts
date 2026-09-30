import type { TaskAction } from "./task-action.js";

export type RewindPreview = {
  readonly id: string;
  readonly taskId: string;
  readonly messageId: string;
  readonly draft: string;
  readonly discardedMessages: number;
  readonly discardedActions: readonly TaskAction[];
  readonly files: readonly RewindFileEffect[];
};

export type RewindFileEffect = {
  readonly path: string;
  readonly action: "restore" | "remove" | "unknown";
  readonly status: "recoverable" | "conflict" | "unprotected";
  readonly reason?: string;
};

export type RewindCommitResult = {
  readonly files: readonly {
    readonly path: string;
    readonly status: "restored" | "removed" | "conflict" | "unprotected";
    readonly reason?: string;
  }[];
};
