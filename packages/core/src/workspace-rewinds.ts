import type {
  RewindCommitResult,
  RewindPreview,
  WorkspaceTask,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { Rewind, RewindHost } from "@zhiyin/rewind";

const recoveryIssue =
  "A file recovery operation could not be finished. The affected conversation will stay paused until recovery succeeds.";

export class WorkspaceRewinds {
  readonly #rewind: Rewind;
  readonly #host: RewindHost;
  readonly #historyAvailable: () => boolean;
  readonly #running: (taskId: string) => boolean;

  constructor(options: {
    readonly rewind: Rewind;
    readonly task: (taskId: string) => WorkspaceTask;
    readonly save: (task: WorkspaceTask) => Promise<void>;
    readonly historyAvailable: () => boolean;
    readonly running: (taskId: string) => boolean;
  }) {
    this.#rewind = options.rewind;
    this.#host = { task: options.task, save: options.save };
    this.#historyAvailable = options.historyAvailable;
    this.#running = options.running;
  }

  async resume(): Promise<string | undefined> {
    try {
      await this.#rewind.resume(this.#host);
      return undefined;
    } catch {
      return recoveryIssue;
    }
  }

  async preview(taskId: string, messageId: string): Promise<RewindPreview> {
    if (!this.#historyAvailable())
      throw new VisibleError(
        "Saved history is unavailable. Retry after restoring access.",
      );
    if (this.#running(taskId))
      throw new VisibleError(
        "Stop this task before returning to an earlier message.",
      );
    const result = await this.#rewind.preview(taskId, messageId, this.#host);
    if (!result.ok) throw new VisibleError(result.reason);
    return result.preview;
  }

  async commit(
    taskId: string,
    rewindId: string,
    files: "keep" | "restore",
  ): Promise<RewindCommitResult> {
    if (this.#running(taskId))
      throw new VisibleError(
        "Stop this task before returning to an earlier message.",
      );
    const result = await this.#rewind.commit(
      taskId,
      rewindId,
      files,
      this.#host,
    );
    if (!result.ok) throw new VisibleError(result.reason);
    return result.result;
  }
}
