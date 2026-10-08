/**
 * Which process owns a data folder.
 *
 * The write queue orders this process's saves and knows nothing about any
 * other process. Two instances, each saving what changed since its own last
 * save, would write over or tangle each other's changes with nothing to say
 * it had happened, so a second instance is prohibited rather than coordinated.
 *
 * On Windows the lock is a file held open with no sharing for as long as the
 * app runs, which the operating system lets go of when the app is gone,
 * however it went: nothing is left to go stale, and no process id is trusted.
 * Elsewhere the lock records a process id, and a lock whose process is no
 * longer running is taken over.
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { holdExclusively, type HeldFile } from "@zhiyin/process-ownership";
import { SessionStoreError } from "./errors.js";
import { isRecord } from "./saved-values.js";

export type OwnershipOptions = {
  /** Replaced in tests, where a dead process id has to be a known quantity. */
  readonly processIsRunning?: (pid: number) => boolean;
  /** Which process this instance speaks for. Injected so two owners can be tested. */
  readonly pid?: number;
  readonly now?: () => Date;
};

/**
 * Signal 0 delivers nothing and only reports whether the process is there.
 * `EPERM` means it exists and belongs to someone else, which still counts.
 */
function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Ownership belongs to a process, not to one store object: the handle a
 * process holds is shared by every store it opens on the same folder, and a
 * second process — or a different process id, in tests — is refused.
 */
const heldHere = new Map<
  string,
  { readonly pid: number; readonly file: HeldFile }
>();

export class FolderOwnership {
  readonly #lockFile: string;
  readonly #processIsRunning: (pid: number) => boolean;
  readonly #pid: number;
  readonly #now: () => Date;
  #owned = false;

  constructor(lockFile: string, options: OwnershipOptions = {}) {
    this.#lockFile = lockFile;
    this.#processIsRunning = options.processIsRunning ?? processIsRunning;
    this.#pid = options.pid ?? process.pid;
    this.#now = options.now ?? (() => new Date());
  }

  /** Takes the folder for this process, or refuses with why. */
  async claim(
    inUse = "Another copy of the app is already using this data. Close it and try again.",
  ): Promise<void> {
    if (this.#owned) return;
    if (process.platform === "win32") this.#hold(inUse);
    else await this.#record(inUse);
    this.#owned = true;
  }

  /**
   * Every durable write goes through here first. An instance that was refused
   * ownership must not be able to write anyway — a refusal that only stops the
   * launch, and not the writes, is not a lock.
   */
  require(): Promise<void> {
    return this.claim(
      "Another copy of the app is using this data, so nothing was saved.",
    );
  }

  /** Gives the folder up so the next launch does not have to wait out a lock. */
  async release(): Promise<void> {
    this.#owned = false;
    const held = heldHere.get(this.#key);
    if (held) {
      heldHere.delete(this.#key);
      held.file.release();
      return;
    }
    await rm(this.#lockFile, { force: true }).catch(() => {});
  }

  get #key(): string {
    return resolve(this.#lockFile).toLowerCase();
  }

  #hold(inUse: string): void {
    const here = heldHere.get(this.#key);
    if (here) {
      if (here.pid === this.#pid) return;
      throw new SessionStoreError("in-use", inUse);
    }
    const attempt = holdExclusively(this.#lockFile);
    if ("held" in attempt) {
      heldHere.set(this.#key, { pid: this.#pid, file: attempt.held });
      return;
    }
    if (attempt.refused === "held-elsewhere")
      throw new SessionStoreError("in-use", inUse);
    throw new SessionStoreError(
      "unavailable",
      "This data folder could not be claimed.",
    );
  }

  async #record(inUse: string): Promise<void> {
    const holder = await this.#currentOwner();
    if (holder !== undefined && holder !== this.#pid)
      throw new SessionStoreError("in-use", inUse);
    try {
      await writeFile(
        this.#lockFile,
        JSON.stringify({ pid: this.#pid, since: this.#now().toISOString() }),
        "utf8",
      );
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "This data folder could not be claimed.",
        { cause: error },
      );
    }
  }

  /**
   * The process holding the folder, or nothing if it is free. A lock that
   * cannot be read or parsed is treated as free: an unreadable lock would
   * otherwise be an app that never starts again.
   */
  async #currentOwner(): Promise<number | undefined> {
    let source: string;
    try {
      source = await readFile(this.#lockFile, "utf8");
    } catch {
      return undefined;
    }
    try {
      const value: unknown = JSON.parse(source);
      if (!isRecord(value) || typeof value.pid !== "number") return undefined;
      return this.#processIsRunning(value.pid) ? value.pid : undefined;
    } catch {
      return undefined;
    }
  }
}
