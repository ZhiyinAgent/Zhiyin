/**
 * How long the records that undo writes are kept (ADR 0026). A write a
 * conversation made is undone from its card, so its record is kept while the
 * conversation shows that card. A change the person made on the Memory page
 * stays undoable for seven days. Past that, or once a write's card is gone,
 * nothing can offer its Undo, and its record, which may hold a removed
 * entry's whole text, is let go. So is the record of a waiting change once
 * the change no longer waits.
 */

import type { MemoryWaiting } from "@zhiyin/contract";
import type { MemoryFolder } from "./memory-folder.js";
import type { WriteRecord } from "./writes.js";

/** How long the person's own changes stay undoable. */
const personsUndoDays = 7;
const personsUndoMs = personsUndoDays * 24 * 60 * 60 * 1000;
/** How often, at most, old records are looked for. */
const lookEveryMs = 60 * 60 * 1000;

export class UndoRecords {
  readonly #folder: MemoryFolder;
  readonly #now: () => Date;
  #lookedAt: number | undefined;

  constructor(folder: MemoryFolder, now: () => Date) {
    this.#folder = folder;
    this.#now = now;
  }

  /** Whether the record can still undo its write. */
  usable(write: WriteRecord): boolean {
    return (
      write.conversation !== undefined ||
      this.#now().getTime() - Date.parse(write.at) < personsUndoMs
    );
  }

  /**
   * Lets go of the person's own changes past their time, and of the records
   * of waiting changes no longer waiting, looking at most once an hour, and
   * at once after memory is opened.
   */
  async letGoOfOld(): Promise<void> {
    const now = this.#now().getTime();
    if (this.#lookedAt !== undefined && now - this.#lookedAt < lookEveryMs)
      return;
    this.#lookedAt = now;
    const waiting = new Set(
      (await this.#folder.ownRecords<MemoryWaiting>("waiting")).map(
        (one) => one.id,
      ),
    );
    await this.#letGo(
      (write) =>
        !this.usable(write) ||
        (write.kind === "waiting" && !waiting.has(write.waitingId)),
    );
  }

  /** Lets go of what undoes a waiting change the person kept or discarded. */
  waitingDecided(waitingId: string): Promise<void> {
    return this.#letGo(
      (write) => write.kind === "waiting" && write.waitingId === waitingId,
    );
  }

  /**
   * The conversation no longer shows these writes' cards, so nothing can
   * offer their Undo: what they wrote stays, and their records are let go.
   * The person changes those entries on the Memory page like any other.
   */
  cardsGone(writeIds: readonly string[]): Promise<void> {
    const gone = new Set(writeIds);
    return this.#letGo(
      (write) => write.conversation !== undefined && gone.has(write.id),
    );
  }

  /** Lets go of what undoes a deleted conversation's writes: its cards are gone. */
  conversationDeleted(conversationId: string): Promise<void> {
    return this.#letGo((write) => write.conversation === conversationId);
  }

  async #letGo(matches: (write: WriteRecord) => boolean): Promise<void> {
    for (const write of await this.#folder.ownRecords<WriteRecord>("writes"))
      if (matches(write)) await this.#folder.dropOwnRecord("writes", write.id);
  }
}
