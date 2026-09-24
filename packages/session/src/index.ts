/**
 * Persists conversations so they can be resumed, and tracks each turn's file
 * changes so they can be undone.
 *
 * Boundaries and invariants: docs/architecture/features/session/README.md
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type MessageAttachment,
  type ProducedImage,
  type StoredPicture,
  type WorkspaceSnapshot,
} from "@zhiyin/contract";
import { isRecord } from "./saved-workspace.js";
import {
  HistoryStore,
  type OpenedConversation,
  type SavedIndex,
} from "./history-store.js";
import { historyFiles, type HistoryFiles } from "./history-log.js";
import { SessionStoreError } from "./errors.js";
import { FolderOwnership, type OwnershipOptions } from "./owner-lock.js";
import {
  KeptItems,
  type FileRead,
  type KeptItem,
  type KeptKind,
  type KeptLimits,
  type KeptSource,
  type LocatedItem,
} from "./kept-items.js";

export {
  defaultKeptLimits,
  type FileRead,
  type KeptItem,
  type KeptKind,
  type KeptLimits,
  type KeptSource,
  type LocatedItem,
} from "./kept-items.js";

export { SessionStoreError } from "./errors.js";
export type { OpenedConversation, SavedIndex } from "./history-store.js";
export { historyFiles, type HistoryFiles } from "./history-log.js";

export interface SessionSummary {
  readonly id: string;
  /** Always producible, even for a session trimmed for the model's context. */
  readonly label: string;
}

/**
 * What the history holds: the conversations and the choices a person made.
 * Connection, plugin, usage, and browser state are only true while the app
 * runs and are read again at every launch, so they are never stored.
 *
 * `conversations` is the whole list and `tasks` the conversations opened; a
 * listed conversation that is not open is left as it is on disk.
 */
export type SavedWorkspace = Pick<
  WorkspaceSnapshot,
  | "preferences"
  | "contextBudget"
  | "workspace"
  | "recentWorkspaces"
  | "tasks"
  | "conversations"
  | "selectedTaskId"
>;

export interface Sessions {
  /**
   * The conversations, newest first, and the choices, without opening any
   * conversation.
   */
  loadIndex(): Promise<SavedIndex | undefined>;
  /** One conversation, read when it is first opened. */
  openConversation(id: string): Promise<OpenedConversation>;
  /** Every conversation opened at once. One that will not open fails the read. */
  loadWorkspace(): Promise<SavedWorkspace | undefined>;
  /**
   * Stores the durable part of a workspace, writing only what changed since
   * the last save; anything else given is not written.
   */
  saveWorkspace(
    workspace: SavedWorkspace,
    options?: { readonly commit?: () => boolean },
  ): Promise<void>;
  /**
   * Keeps a picture a conversation refers to, and answers with the name it is
   * referred to by. Stored beside the conversation rather than inside it: an
   * encoded image is large, and a conversation's file is read whole whenever
   * the conversation is opened. A connector's pictures are kept apart from the
   * tools', so one filling up never removes the other's.
   */
  savePicture(
    conversationId: string,
    image: ProducedImage,
    from?: "tool" | "connector",
  ): Promise<string>;
  /**
   * The picture, or why it is not there — never a guess at what it was. A
   * picture the store deleted to stay inside its limits says so, because
   * "missing" and "removed on purpose" are different things to be told.
   */
  readPicture(source: string): Promise<StoredPicture>;
  /**
   * Keeps a tool's full output, or a long text a person pasted, for a
   * conversation. A paste made before its conversation exists is kept as a
   * draft, and is moved into the conversation when its message is sent.
   */
  keep(
    kind: "output" | "pastedText",
    conversationId: string | undefined,
    source: KeptSource,
  ): Promise<KeptItem>;
  /**
   * Where a kept output or paste is, or why it is not there. With no
   * conversation, a draft paste not yet sent.
   */
  locate(
    kind: "output" | "pastedText",
    conversationId: string | undefined,
    id: string,
  ): Promise<LocatedItem>;
  /** Moves draft pastes into the conversation their message was sent in. */
  claimDrafts(
    conversationId: string,
    ids: readonly string[],
  ): Promise<readonly MessageAttachment[]>;
  /** Everything a deleted conversation kept beside itself goes with it. */
  forgetConversation(conversationId: string): Promise<void>;
  /** When a file was last read in a conversation, as it was then. */
  lastRead(conversationId: string, path: string): Promise<FileRead | undefined>;
  noteRead(conversationId: string, path: string, read: FileRead): Promise<void>;
  list(): Promise<readonly SessionSummary[]>;
  /** Idempotent: undoing twice does nothing the second time. */
  undo(turnId: string): Promise<void>;
  /** What is left of a history whose settings will not open. Changes nothing. */
  inspectDamage(): Promise<DamageReport>;
  /** Copies what is damaged somewhere safe and answers where. Changes nothing else. */
  preserveDamaged(): Promise<string>;
  /** Keeps what is damaged, then starts the settings afresh beside what could be read. */
  recoverReadable(): Promise<{
    readonly recovered: number;
    readonly discarded: number;
    readonly kept: string;
  }>;
}

/** What is left of a history whose settings will not open. */
export type DamageReport =
  | { readonly kind: "unreadable" }
  | {
      readonly kind: "partial";
      readonly readable: number;
      readonly damaged: number;
    };

export class FileSessions implements Sessions {
  readonly #directory: string;
  readonly #ownership: FolderOwnership;
  readonly #kept: KeptItems;
  readonly #now: () => Date;
  readonly #history: HistoryStore;
  /** Every read and write of the history, in the order they were asked for. */
  #queue: Promise<void> = Promise.resolve();

  constructor(
    directory: string,
    options: {
      readonly kept?: Partial<Record<KeptKind, Partial<KeptLimits>>>;
      readonly now?: () => Date;
      /** Replaced by boundary tests that make a history write fail or count it. */
      readonly historyFiles?: HistoryFiles;
    } & OwnershipOptions = {},
  ) {
    this.#directory = directory;
    this.#ownership = new FolderOwnership(
      join(directory, "owner.lock"),
      options,
    );
    this.#now = options.now ?? (() => new Date());
    this.#kept = new KeptItems(
      join(directory, "kept"),
      options.kept ?? {},
      this.#now,
    );
    this.#history = new HistoryStore(
      directory,
      options.historyFiles ?? historyFiles,
      this.#now,
    );
  }

  /**
   * Runs after everything asked for before it. The queue is joined before
   * anything is awaited, so work commits in the order it was submitted.
   */
  #queued<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Takes ownership of the data directory for this process, or refuses. */
  async claim(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await this.#ownership.claim();
    await this.#kept.clearDrafts();
  }

  /** Gives the folder up so the next launch does not have to wait out a lock. */
  release(): Promise<void> {
    return this.#ownership.release();
  }

  async savePicture(
    conversationId: string,
    image: ProducedImage,
    from: "tool" | "connector" = "tool",
  ): Promise<string> {
    const kind = from === "tool" ? "toolPictures" : "connectorPictures";
    try {
      const kept = await this.#kept.keep(kind, conversationId, {
        text: JSON.stringify(image),
      });
      return this.#kept.source(kind, conversationId, kept.id);
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "A picture could not be saved.",
        { cause: error },
      );
    }
  }

  async readPicture(source: string): Promise<StoredPicture> {
    const located = await this.#kept.locateSource(source, "toolPictures");
    if (located.status === "ready")
      try {
        const stored: unknown = JSON.parse(
          await readFile(located.path, "utf8"),
        );
        if (
          isRecord(stored) &&
          typeof stored.mediaType === "string" &&
          typeof stored.data === "string"
        )
          return {
            status: "ready",
            mediaType: stored.mediaType,
            data: stored.data,
          };
      } catch {
        // Unreadable is gone, as far as a conversation can tell.
      }
    return {
      status: "missing",
      reason:
        located.status === "missing"
          ? located.reason
          : "This picture is no longer stored with the conversation.",
    };
  }

  keep(
    kind: "output" | "pastedText",
    conversationId: string | undefined,
    source: KeptSource,
  ): Promise<KeptItem> {
    return this.#kept.keep(kind, conversationId, source);
  }

  locate(
    kind: "output" | "pastedText",
    conversationId: string | undefined,
    id: string,
  ): Promise<LocatedItem> {
    return this.#kept.locate(kind, conversationId, id);
  }

  claimDrafts(
    conversationId: string,
    ids: readonly string[],
  ): Promise<readonly MessageAttachment[]> {
    return this.#kept.claimDrafts(conversationId, ids);
  }

  forgetConversation(conversationId: string): Promise<void> {
    return this.#kept.forget(conversationId);
  }

  lastRead(
    conversationId: string,
    path: string,
  ): Promise<FileRead | undefined> {
    return this.#kept.lastRead(conversationId, path);
  }

  noteRead(
    conversationId: string,
    path: string,
    read: FileRead,
  ): Promise<void> {
    return this.#kept.noteRead(conversationId, path, read);
  }

  loadIndex(): Promise<SavedIndex | undefined> {
    return this.#queued(() => this.#history.loadIndex());
  }

  openConversation(id: string): Promise<OpenedConversation> {
    return this.#queued(() => this.#history.open(id));
  }

  loadWorkspace(): Promise<SavedWorkspace | undefined> {
    return this.#queued(() => this.#history.loadAll());
  }

  inspectDamage(): Promise<DamageReport> {
    return this.#queued(() => this.#history.inspectDamage());
  }

  preserveDamaged(): Promise<string> {
    return this.#queued(() => this.#history.preserveDamaged());
  }

  recoverReadable(): Promise<{
    readonly recovered: number;
    readonly discarded: number;
    readonly kept: string;
  }> {
    return this.#queued(async () => {
      await this.#ownership.require();
      return this.#history.recoverReadable();
    });
  }

  /**
   * Ownership is checked inside the queued work: awaiting it out here would
   * let a later save overtake an earlier one while the check was in flight.
   */
  saveWorkspace(
    workspace: SavedWorkspace,
    options: { readonly commit?: () => boolean } = {},
  ): Promise<void> {
    return this.#queued(async () => {
      await this.#ownership.require();
      await this.#history.save(workspace, options.commit ?? (() => true));
    });
  }

  async list(): Promise<readonly SessionSummary[]> {
    const index = await this.loadIndex();
    return (
      index?.conversations.map((item) => ({
        id: item.id,
        label: item.title,
      })) ?? []
    );
  }

  async undo(): Promise<void> {
    throw new SessionStoreError(
      "unavailable",
      "File undo is not available yet.",
    );
  }
}
