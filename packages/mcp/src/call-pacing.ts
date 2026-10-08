/**
 * Spaces the calls sent to each connection so none is flooded.
 *
 * A model that writes quickly, with every call approved in advance, can send a
 * burst no remote service accepts. A connection that declares a rate has its
 * calls released one interval apart — after the previous one actually was, not
 * after the moment it was booked, which a busy process can overrun. One that
 * declares none gets one call at a time: a burst is calls sent together, and
 * serialising them avoids most refusals without guessing a number.
 *
 * Declared rates are not enough: a service may refuse well under the rate it
 * documents. So a refusal for rate holds back every later call to that
 * connection, for longer after each refusal in a row, until a call succeeds.
 */

const FIRST_COOL_DOWN_MS = 2_000;
export const LONGEST_COOL_DOWN_MS = 60_000;

type CallOutcome = "answered" | "refused" | "failed";

/** A call's place in its connection's line, given up once it is answered. */
export type PacedCall = {
  /** `retryAfterMs` is the wait the server asked for, when it said. */
  finished(outcome: CallOutcome, retryAfterMs?: number): void;
};

export class CallPacing {
  /**
   * For each connection, when the latest call queued may let the next go: at
   * its release for a declared rate, once it is answered otherwise.
   */
  readonly #passed = new Map<string, Promise<number>>();
  /** Until when each connection is held back after a refusal. */
  readonly #coolUntil = new Map<string, number>();
  /** How long the next refusal in a row holds a connection back. */
  readonly #nextCoolDown = new Map<string, number>();

  /**
   * Resolves once a call to `id` may be sent, or `undefined` if it was stopped
   * while it waited — in which case it must not be sent at all, and its turn
   * passes to the next call. A call that is sent must say when it finished.
   */
  async turn(
    id: string,
    requestsPerMinute: number | undefined,
    signal?: AbortSignal,
  ): Promise<PacedCall | undefined> {
    if (signal?.aborted) return undefined;
    const previous = this.#passed.get(id) ?? Promise.resolve(-Infinity);
    let pass!: (at: number | Promise<number>) => void;
    this.#passed.set(id, new Promise((resolve) => (pass = resolve)));
    const before = await stoppable(previous, signal);
    if (before !== undefined && requestsPerMinute)
      await until(before + 60_000 / requestsPerMinute, signal);
    // A refusal may arrive while this call waits, and push the time back.
    while (!signal?.aborted) {
      const coolUntil = this.#coolUntil.get(id) ?? -Infinity;
      if (performance.now() >= coolUntil) break;
      await until(coolUntil, signal);
    }
    if (signal?.aborted) {
      pass(previous);
      return undefined;
    }
    if (requestsPerMinute) pass(performance.now());
    let done = false;
    return {
      finished: (outcome, retryAfterMs) => {
        if (done) return;
        done = true;
        if (outcome === "refused") this.#refused(id, retryAfterMs);
        if (outcome === "answered") {
          this.#coolUntil.delete(id);
          this.#nextCoolDown.delete(id);
        }
        if (!requestsPerMinute) pass(performance.now());
      },
    };
  }

  #refused(id: string, retryAfterMs?: number): void {
    const coolDown = this.#nextCoolDown.get(id) ?? FIRST_COOL_DOWN_MS;
    const wait = Math.min(
      LONGEST_COOL_DOWN_MS,
      Math.max(coolDown, retryAfterMs ?? 0),
    );
    this.#coolUntil.set(id, performance.now() + wait);
    this.#nextCoolDown.set(id, Math.min(LONGEST_COOL_DOWN_MS, coolDown * 2));
  }
}

/** Waits until `due` by this clock, or until the signal stops it. */
async function until(due: number, signal?: AbortSignal): Promise<void> {
  // A timer may fire a fraction early by this clock.
  while (!signal?.aborted && performance.now() < due)
    await delay(Math.ceil(due - performance.now()), signal);
}

/** The promise's value, or `undefined` as soon as the signal stops it. */
function stoppable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const stop = () => resolve(undefined);
    signal.addEventListener("abort", stop, { once: true });
    void promise.then((value) => {
      signal.removeEventListener("abort", stop);
      resolve(value);
    });
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}
