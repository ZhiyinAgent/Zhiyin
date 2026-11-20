/**
 * The entry numbers a conversation's writes were taken back from, as when the
 * person went back past the turn that kept them or undid it, so the
 * conversation's model reading one again is told why it is gone. Only the
 * number and how it was taken back are kept, never an entry's text, and they
 * go with the conversation.
 */

import { join } from "node:path";
import type { MemoryFolder } from "./memory-folder.js";

/** How a write was taken back with the turn that made it. */
export type TakenBackBy = "going back" | "undoing the turn";

type Kept = { readonly numbers: Readonly<Record<string, TakenBackBy>> };

const said: Record<TakenBackBy, string> = {
  "going back": "went back past",
  "undoing the turn": "undid",
};

/** What the model is told of a number taken back. */
export function takenBackText(number: number, by: TakenBackBy): string {
  return `#${number} was taken back when the person ${said[by]} the turn that kept it.`;
}

export class TakenBack {
  readonly #folder: MemoryFolder;

  constructor(folder: MemoryFolder) {
    this.#folder = folder;
  }

  /** Where a conversation's numbers are kept; nothing for an id that is no plain name. */
  #path(conversationId: string): string | undefined {
    return /^[A-Za-z0-9_-]+$/.test(conversationId)
      ? join(
          this.#folder.root,
          ".zhiyin",
          "taken-back",
          `${conversationId}.json`,
        )
      : undefined;
  }

  async of(
    conversationId: string,
  ): Promise<Readonly<Record<string, TakenBackBy>>> {
    const path = this.#path(conversationId);
    return (path && (await this.#folder.readJson<Kept>(path))?.numbers) || {};
  }

  async note(
    conversationId: string,
    number: number,
    by: TakenBackBy,
  ): Promise<void> {
    const path = this.#path(conversationId);
    if (!path) return;
    const numbers = { ...(await this.of(conversationId)), [number]: by };
    await this.#folder.writeJson(path, { numbers });
  }

  async conversationDeleted(conversationId: string): Promise<void> {
    const path = this.#path(conversationId);
    if (path) await this.#folder.forget(path);
  }
}
