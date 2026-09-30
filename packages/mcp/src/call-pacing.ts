/**
 * Spaces the calls sent to each connection so none exceeds the rate its
 * declaration gives.
 *
 * A model that writes quickly, with every call approved in advance, can send a
 * burst no remote service accepts, and a refused call is not something the
 * service tells us how long to wait out. So calls to a paced connection queue,
 * and each is released one interval after the one before it actually was — not
 * after the moment it was booked, which a busy process can overrun. A
 * connection that declares no rate is never held back.
 */
export class CallPacing {
  /** When the latest call queued for each connection was released. */
  readonly #released = new Map<string, Promise<number>>();

  /**
   * Resolves `true` once a call to `id` may be sent, or `false` if it was
   * stopped while it waited — in which case it must not be sent at all, and
   * its turn passes to the next call.
   */
  async wait(
    id: string,
    requestsPerMinute: number | undefined,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (!requestsPerMinute) return !signal?.aborted;
    const previous = this.#released.get(id) ?? Promise.resolve(-Infinity);
    let release!: (at: number | Promise<number>) => void;
    this.#released.set(id, new Promise((resolve) => (release = resolve)));
    const before = await stoppable(previous, signal);
    if (before !== undefined) {
      const due = before + 60_000 / requestsPerMinute;
      // A timer may fire a fraction early by this clock.
      while (!signal?.aborted && performance.now() < due)
        await delay(Math.ceil(due - performance.now()), signal);
    }
    if (signal?.aborted) {
      release(previous);
      return false;
    }
    release(performance.now());
    return true;
  }
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
