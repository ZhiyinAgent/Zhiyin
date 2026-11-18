/**
 * Work run one piece at a time, in the order it was asked for: each piece
 * starts once the one before it has settled, whether that succeeded or
 * failed. A piece that fails fails its own caller only; the next still runs.
 */

type Work<T> = () => T | PromiseLike<T>;

const settledOf = (work: Promise<unknown>): Promise<void> =>
  work.then(
    () => undefined,
    () => undefined,
  );

export class Serial {
  #last: Promise<void> = Promise.resolve();

  /** Runs `work` after everything asked before it, and answers what it gives. */
  run<T>(work: Work<T>): Promise<T> {
    const done = this.#last.then(work);
    this.#last = settledOf(done);
    return done;
  }

  /** Settles once everything asked for so far has settled. */
  settled(): Promise<void> {
    return this.#last;
  }
}

/**
 * One line of work per key: work under one key runs one piece at a time, and
 * work under different keys runs side by side. A key is let go of once its
 * last piece settles, so keys that come and go are not kept.
 */
export class SerialByKey {
  readonly #last = new Map<string, Promise<void>>();

  /** Runs `work` after everything asked before it under `key`. */
  run<T>(key: string, work: Work<T>): Promise<T> {
    const done = (this.#last.get(key) ?? Promise.resolve()).then(work);
    const settled = settledOf(done);
    this.#last.set(key, settled);
    void settled.then(() => {
      if (this.#last.get(key) === settled) this.#last.delete(key);
    });
    return done;
  }

  /**
   * Settles once nothing under `key` is waiting or running, including work
   * asked for while this waits.
   */
  async settled(key: string): Promise<void> {
    for (let last = this.#last.get(key); last; last = this.#last.get(key))
      await last;
  }
}
