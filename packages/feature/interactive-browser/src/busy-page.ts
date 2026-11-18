/**
 * Keeps a call from waiting for ever on a page whose script never yields.
 * Such a page answers nothing, so whatever waits on it, a navigation, its
 * title, a picture or a tool, would wait as long as the script runs. While a
 * call runs, the page is asked a question that costs it nothing; one left
 * unanswered for the bound means its script holds the page, and that script
 * is stopped, so the call goes on. A page that still does not answer once
 * stopped, or that waits on a dialog it showed, ends the calls with that
 * reason instead: a dialog is the model's to answer, and stopping the script
 * behind it would change what answering it does. Calls made at once, or one
 * inside another, share one watch, so one stop is one stop.
 */

/** The page, as the watch reaches it. */
export type WatchedPage = {
  /** Settles once the page's script yields to it. */
  answers(): Promise<unknown>;
  /** Stops the script the page runs now. */
  stop(): Promise<unknown>;
  /** Whether the page waits on a dialog it showed. */
  asking(): boolean;
};

/** `value` after `ms`, or nothing once `until` settles first. */
function after<T>(ms: number, value: T, until: Promise<unknown>): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(value), ms);
    void until.finally(() => clearTimeout(timer));
  });
}

export class BusyPageWatch {
  readonly #page: WatchedPage;
  readonly #ms: number;
  /** How to end each call still running, should the page not answer. */
  readonly #running = new Set<(error: Error) => void>();
  #watching = false;
  /** Ends the watch's rest once no call runs. */
  #quiet: (() => void) | undefined;
  /** Scripts stopped since this was last asked. */
  #stopped = 0;

  constructor(page: WatchedPage, ms: number) {
    this.#page = page;
    this.#ms = ms;
  }

  /** Runs `work`, stopping a script that keeps the page from answering. */
  during<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#running.add(reject);
      work()
        .then(resolve, reject)
        .finally(() => {
          this.#running.delete(reject);
          if (!this.#running.size) this.#quiet?.();
        });
      void this.#watch();
    });
  }

  /**
   * What stopping the page's scripts since this was last asked comes to, as
   * a clause, or nothing when none was stopped.
   */
  takeStopped(): string | undefined {
    const stopped = this.#stopped;
    this.#stopped = 0;
    return stopped ? this.#said(stopped) : undefined;
  }

  async #watch(): Promise<void> {
    if (this.#watching) return;
    this.#watching = true;
    try {
      let stoppedNow = false;
      while (this.#running.size) {
        const asked = this.#page.answers().then(
          () => "answered" as const,
          () => "answered" as const,
        );
        const heard = await Promise.race([
          asked,
          after(this.#ms, "silent" as const, asked),
        ]);
        if (!this.#running.size) return;
        if (heard === "answered") {
          stoppedNow = false;
          await this.#rest();
          continue;
        }
        if (this.#page.asking())
          this.#end(
            "The page is waiting on its dialog: answer it with browser_handle_dialog.",
          );
        else if (stoppedNow)
          this.#end(
            `The page does not answer: ${this.#said(1)}, and it still does not answer.`,
          );
        else {
          await this.#page.stop().catch(() => undefined);
          this.#stopped += 1;
          stoppedNow = true;
        }
      }
    } finally {
      this.#watching = false;
    }
  }

  /** The bound, or until no call runs, whichever comes first. */
  #rest(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.#quiet?.(), this.#ms);
      this.#quiet = () => {
        clearTimeout(timer);
        this.#quiet = undefined;
        resolve();
      };
    });
  }

  /** Ends every call still running, saying why. */
  #end(reason: string): void {
    const running = [...this.#running];
    this.#running.clear();
    for (const reject of running) reject(new Error(reason));
  }

  #said(times: number): string {
    const seconds = Math.max(1, Math.round(this.#ms / 1000));
    return `its script kept the page busy for ${seconds} s without yielding, so Zhiyin stopped it${times > 1 ? ` (${times} times)` : ""}`;
  }
}
