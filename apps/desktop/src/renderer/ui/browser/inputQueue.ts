import { useEffect, useLayoutEffect, useState } from "react";
import type { BrowserIntent } from "@zhiyin/contract";

/**
 * Two steps waiting to be sent, as one when they can be: a pointer moving
 * again replaces where it moved before, and turns of the wheel add up. Both
 * come many times a second; anything else is sent as it was done.
 */
function joined(
  waiting: BrowserIntent,
  next: BrowserIntent,
): BrowserIntent | undefined {
  if (
    waiting.kind === "pointer" &&
    next.kind === "pointer" &&
    waiting.action === "move" &&
    next.action === "move"
  )
    return next;
  if (waiting.kind === "scroll" && next.kind === "scroll")
    return {
      ...next,
      deltaX: waiting.deltaX + next.deltaX,
      deltaY: waiting.deltaY + next.deltaY,
    };
  return undefined;
}

/**
 * What a person does on the page, sent one step at a time in the order it was
 * done: each waits for the one before to land, so a release never overtakes
 * its press, and what piles up meanwhile is joined rather than sent late one
 * by one. A step that fails does not hold back the next.
 */
export class InputQueue {
  #send: (intent: BrowserIntent) => unknown = () => undefined;
  readonly #waiting: BrowserIntent[] = [];
  #sending = false;
  #stopped = false;

  /** Where each step goes from now on. */
  sendThrough(send: (intent: BrowserIntent) => unknown): void {
    this.#send = send;
  }

  add(intent: BrowserIntent): void {
    if (this.#stopped) return;
    const last = this.#waiting.at(-1);
    const both = last && joined(last, intent);
    if (both) this.#waiting[this.#waiting.length - 1] = both;
    else this.#waiting.push(intent);
    if (!this.#sending) void this.#drain();
  }

  /**
   * Sends nothing more, for a panel that is gone: what waits would land on
   * the page of whichever conversation is open next.
   */
  stop(): void {
    this.#stopped = true;
    this.#waiting.length = 0;
  }

  /** Takes steps again, for a panel shown again. */
  start(): void {
    this.#stopped = false;
  }

  async #drain(): Promise<void> {
    this.#sending = true;
    for (
      let next = this.#waiting.shift();
      next && !this.#stopped;
      next = this.#waiting.shift()
    ) {
      try {
        await this.#send(next);
      } catch {
        // Said to the person where the step was sent; the next still goes.
      }
    }
    this.#sending = false;
  }
}

/** One queue while the panel is shown, sending through the latest `send`. */
export function useInputQueue(
  send: (intent: BrowserIntent) => unknown,
): InputQueue {
  const [queue] = useState(() => new InputQueue());
  useLayoutEffect(() => {
    queue.sendThrough(send);
  });
  useEffect(() => {
    queue.start();
    return () => queue.stop();
  }, [queue]);
  return queue;
}
