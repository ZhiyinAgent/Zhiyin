/**
 * Which process owns a data folder.
 *
 * The write queue orders this process's saves and knows nothing about any
 * other process. Two instances, each saving what changed since its own last
 * save, would write over or tangle each other's changes with nothing to say
 * it had happened, so a second instance is prohibited rather than coordinated.
 *
 * The lock is a file held open with no sharing for as long as the app runs,
 * which Windows lets go of when the app is gone, however it went: nothing is
 * left to go stale, and no process id is trusted.
 */

import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { holdExclusively, type HeldFile } from "@zhiyin/process-ownership";
import { SessionStoreError } from "./errors.js";

export type OwnershipOptions = {
  /** Which process this instance speaks for. Injected so two owners can be tested. */
  readonly pid?: number;
};

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
  readonly #pid: number;
  #owned = false;

  constructor(lockFile: string, options: OwnershipOptions = {}) {
    this.#lockFile = lockFile;
    this.#pid = options.pid ?? process.pid;
  }

  /** Takes the folder for this process, or refuses with why. */
  async claim(
    inUse = "Another copy of the app is already using this data. Close it and try again.",
  ): Promise<void> {
    if (this.#owned) return;
    this.#hold(inUse);
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
}
