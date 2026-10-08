/**
 * An answer's text and reasoning, shown a fixed time behind the model. ADR 0011.
 *
 * Like a broadcast delay: the model is read at full speed, and each piece is
 * passed on only once it has been held for `delayMs`. Text still held has not
 * been saved or shown anywhere, so a failure that arrives inside the delay can
 * be retried without taking anything back from the person.
 */

type Piece = {
  readonly at: number;
  readonly kind: "text" | "reasoning";
  readonly text: string;
};

export type Revealed = { readonly text: string; readonly reasoning: string };

export class HeldReveal {
  readonly #delayMs: number;
  readonly #show: (revealed: Revealed) => Promise<void>;
  readonly #now: () => number;
  #held: Piece[] = [];
  #revealed: Revealed = { text: "", reasoning: "" };
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Showing is serialised, so pieces reach the conversation in order. */
  #showing: Promise<void> = Promise.resolve();
  #failure: { readonly error: unknown } | undefined;

  constructor(
    delayMs: number,
    show: (revealed: Revealed) => Promise<void>,
    now: () => number = Date.now,
  ) {
    this.#delayMs = delayMs;
    this.#show = show;
    this.#now = now;
  }

  /** What has been shown so far. */
  get revealed(): Revealed {
    return this.#revealed;
  }

  /**
   * Holds one piece. The promise settles once any showing it caused is done,
   * so a caller that awaits it keeps its reading in step with the display.
   */
  add(kind: Piece["kind"], text: string): Promise<void> {
    if (!text) return this.#settled();
    this.#held.push({ at: this.#now(), kind, text });
    if (this.#delayMs <= 0) this.#release(true);
    else this.#schedule();
    return this.#settled();
  }

  /** Shows everything still held: the round ended, so nothing is left to wait for. */
  async flush(): Promise<void> {
    this.#stopTimer();
    this.#release(true);
    await this.#settled();
  }

  /** Drops everything still held, unseen, and waits for showing in progress. */
  async discard(): Promise<void> {
    this.#stopTimer();
    this.#held = [];
    await this.#showing;
  }

  /** Moves what has been held long enough, or everything, into view. */
  #release(everything: boolean) {
    const cutoff = everything
      ? Number.POSITIVE_INFINITY
      : this.#now() - this.#delayMs;
    let { text, reasoning } = this.#revealed;
    while (this.#held.length && this.#held[0]!.at <= cutoff) {
      const piece = this.#held.shift()!;
      if (piece.kind === "text") text += piece.text;
      else reasoning += piece.text;
    }
    if (text === this.#revealed.text && reasoning === this.#revealed.reasoning)
      return;
    const revealed = { text, reasoning };
    this.#revealed = revealed;
    this.#showing = this.#showing
      .then(() => this.#show(revealed))
      .catch((error: unknown) => {
        this.#failure ??= { error };
      });
  }

  #schedule() {
    if (this.#timer !== undefined || !this.#held.length) return;
    const due = this.#held[0]!.at + this.#delayMs - this.#now();
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        this.#release(false);
        this.#schedule();
      },
      Math.max(0, due),
    );
  }

  #stopTimer() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #settled(): Promise<void> {
    await this.#showing;
    if (this.#failure) throw this.#failure.error;
  }
}
