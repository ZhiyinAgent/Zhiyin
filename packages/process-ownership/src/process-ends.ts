import { WAIT_TIMEOUT } from "./kernel32.js";
import type { Win32 } from "./kernel32.js";

/** How many processes one wait can hold, beside the event that wakes it. */
const handlesInOneWait = 63;

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

  /** Calls `ended` once the process ends; at once when it already has. */
  watch(process: unknown, ended: () => void): void {
    if (this.#api.ended(process) !== WAIT_TIMEOUT) {
      ended();
      return;
    }
    this.#waiting.set(process, ended);
    if (this.#held) this.#api.setEvent(this.#wake);
    else this.#hold();
  }

  #hold(): void {
    if (this.#closing || !this.#waiting.size) return;
    if (this.#wake === undefined) {
      this.#wake = this.#api.createEvent();
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
