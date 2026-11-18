/**
 * A record the studio keeps on disk as one JSON file, in a conversation's own
 * folder: read whole and checked, each change waiting for the one before so
 * changes that start together lose none, and the file replaced whole so a
 * reader never meets one half written.
 */

import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { replaceFile } from "@zhiyin/files";
import { Serial } from "@zhiyin/one-at-a-time";

export class JsonRecord<T> {
  readonly #path: string;
  readonly #checked: (value: unknown) => T | undefined;
  readonly #empty: () => T;
  readonly #queue = new Serial();

  /**
   * `checked` gives the value read as the record, or nothing for one not of
   * its shape, which reads as `empty()`, as a file not written yet or cut
   * short does.
   */
  constructor(
    path: string,
    checked: (value: unknown) => T | undefined,
    empty: () => T,
  ) {
    this.#path = path;
    this.#checked = checked;
    this.#empty = empty;
  }

  /** The record as it is once the changes already asked for are made. */
  async read(): Promise<T> {
    await this.#queue.settled();
    return this.#readNow();
  }

  async #readNow(): Promise<T> {
    try {
      const value: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      return this.#checked(value) ?? this.#empty();
    } catch {
      return this.#empty();
    }
  }

  /** Changes the record by `apply`, which may change what it is given, after every change asked before. */
  change(apply: (record: T) => void | Promise<void>): Promise<void> {
    return this.#queue.run(async () => {
      const record = await this.#readNow();
      await apply(record);
      await mkdir(dirname(this.#path), { recursive: true });
      await replaceFile(this.#path, JSON.stringify(record));
    });
  }
}
