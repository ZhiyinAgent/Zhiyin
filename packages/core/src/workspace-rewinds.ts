import type {
  DocumentComparison,
  RewindCommitResult,
  RewindPreview,
  UndoPreview,
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
  readonly #pdfWords: (
    bytes: Uint8Array,
  ) => Promise<readonly string[] | undefined>;

  constructor(options: {
    readonly rewind: Rewind;
    readonly open: (taskId: string) => Promise<void>;
    readonly task: (taskId: string) => WorkspaceTask;
    readonly save: (task: WorkspaceTask) => Promise<void>;
    readonly historyAvailable: () => boolean;
    readonly running: (taskId: string) => boolean;
    readonly pdfWords: (
      bytes: Uint8Array,
    ) => Promise<readonly string[] | undefined>;
  }) {
    this.#rewind = options.rewind;
    this.#host = {
      open: options.open,
      task: options.task,
      save: options.save,
    };
    this.#historyAvailable = options.historyAvailable;
    this.#running = options.running;
    this.#pdfWords = options.pdfWords;
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

  async previewUndo(taskId: string, messageId: string): Promise<UndoPreview> {
    if (!this.#historyAvailable())
      throw new VisibleError(
        "Saved history is unavailable. Retry after restoring access.",
      );
    if (this.#running(taskId))
      throw new VisibleError("Stop this task before undoing its changes.");
    const result = await this.#rewind.previewUndo(
      taskId,
      messageId,
      this.#host,
    );
    if (!result.ok) throw new VisibleError(result.reason);
    return result.preview;
  }

  async compareDocument(
    taskId: string,
    messageId: string,
    path: string,
  ): Promise<DocumentComparison> {
    const versions = await this.#rewind.versions(
      taskId,
      messageId,
      path,
      this.#host,
    );
    if (!versions.ok) throw new VisibleError(versions.reason);
    const before = versions.before && (await this.#pdfWords(versions.before));
    const after = await this.#pdfWords(versions.after);
    if (!after || (versions.before && !before))
      throw new VisibleError(`${path} could not be read as a PDF.`);
    return before ? { before, after } : { after };
  }

  async commitUndo(
    taskId: string,
    undoId: string,
  ): Promise<RewindCommitResult> {
    if (this.#running(taskId))
      throw new VisibleError("Stop this task before undoing its changes.");
    const result = await this.#rewind.commitUndo(taskId, undoId, this.#host);
    if (!result.ok) throw new VisibleError(result.reason);
    return result.result;
  }
}
