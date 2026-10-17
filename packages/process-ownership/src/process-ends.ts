import { WAIT_TIMEOUT } from "./kernel32.js";
import type { Win32 } from "./kernel32.js";

/** How many processes one wait can hold, beside the event that wakes it. */
const handlesInOneWait = 63;
/**
 * The most processes waited on at once: three waits, which leave one of the
 * four threads all file work shares free.
 */
const mostWaited = 3 * handlesInOneWait;

/** Why a process past the most is not started. */
export const tooManyProcesses = `Zhiyin is already waiting on ${mostWaited} programs it started, the most it waits on at once, so it did not start another. Stop one, then try again.`;

/**
 * Tells the end of each running process the moment it happens. Every process
 * waited for shares one wait, held off Zhiyin's own thread: one of the few
 * threads all of its file work shares, however many processes run, and one
 * more for each further sixty-three. The wait wakes when a process ends, or
 * when the set waited for changes, and is held again over what is left. On
 * the way out of the process it is woken and not held again, so quitting
 * never waits on it.
 */
export class ProcessEnds {
  readonly #api: Win32;
  readonly #waiting = new Map<unknown, () => void>();
  #wake: unknown;
  /** Waits held now; the set is held again once every one has returned. */
  #held = 0;
  #closing = false;

  constructor(api: Win32) {
    this.#api = api;
  }

  /** Whether it waits on as many processes as it may. */
  get full(): boolean {
    return this.#waiting.size >= mostWaited;
  }

  /**
   * Calls `ended` once the process ends; at once when it already has.
   * Throws when it is full.
   */
  watch(process: unknown, ended: () => void): void {
    if (this.#api.ended(process) !== WAIT_TIMEOUT) {
      ended();
      return;
    }
    if (this.full) throw new Error(tooManyProcesses);
    this.#waiting.set(process, ended);
    if (this.#held) {
      this.#api.setEvent(this.#wake);
      return;
    }
    try {
      this.#hold();
    } catch (error) {
      this.#waiting.delete(process);
      throw error;
    }
  }

  #hold(): void {
    if (this.#closing || !this.#waiting.size) return;
    if (this.#wake === undefined) {
      const wake = this.#api.createEvent();
      // A wait nothing can wake for a change would return at once, again
      // and again; the next process asks for the event again.
      if (!wake)
        throw new Error(
          "Waiting for the process failed: Windows made no event to wake the wait.",
        );
      this.#wake = wake;
      process.once("exit", () => {
        this.#closing = true;
        if (this.#held) this.#api.setEvent(this.#wake);
      });
    }
    this.#api.resetEvent(this.#wake);
    const processes = [...this.#waiting.keys()];
    for (let start = 0; start < processes.length; start += handlesInOneWait) {
      this.#held += 1;
      this.#api.waitForAny(
        [this.#wake, ...processes.slice(start, start + handlesInOneWait)],
        () => this.#returned(),
      );
    }
  }

  #returned(): void {
    this.#held -= 1;
    // The others return too, so the set is held again whole.
    if (this.#held) {
      this.#api.setEvent(this.#wake);
      return;
    }
    // Whatever woke the wait, each process is asked: several can end at once,
    // and a wait that failed says nothing about which.
    for (const [process, ended] of [...this.#waiting]) {
      if (this.#api.ended(process) === WAIT_TIMEOUT) continue;
      this.#waiting.delete(process);
      ended();
    }
    this.#hold();
  }
}
