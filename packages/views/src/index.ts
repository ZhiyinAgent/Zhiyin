/**
 * Whether a view can be drawn is a question only the surface holding the
 * drawing library can answer, and that surface is not in this process. This is
 * the correlation between asking and being answered: one question out, one
 * answer back, bounded by a timeout so a surface that never replies cannot
 * hold a turn open (ADR 0017).
 *
 * It is deliberately ignorant of how the question travels. The caller supplies
 * `ask`; whether that is IPC, a socket, or a function in the same process is
 * not this feature's business, which is what makes it testable with nothing
 * else present.
 */

import type {
  ViewCheckOutcome,
  ViewCheckRequest,
  ViewKind,
} from "@zhiyin/contract";

/**
 * What the agent loop is given. It never learns that a renderer exists.
 */
export interface ViewValidator {
  validate(kind: ViewKind, source: string): Promise<ViewCheckOutcome>;
}

/**
 * Said for every question that goes unanswered, however it went unanswered:
 * timed out, surface gone, surface unreachable. All three mean the same thing
 * to a caller — nobody judged this — and distinguishing them would invite the
 * repair model to treat "not judged" as "judged and wrong".
 */
const unchecked: ViewCheckOutcome = {
  ok: false,
  reason: "The view could not be checked in time.",
};

const defaultTimeoutMs = 10_000;

export class PendingViewChecks implements ViewValidator {
  readonly #ask: (request: ViewCheckRequest) => void;
  readonly #timeoutMs: number;
  readonly #newId: () => string;
  readonly #waiting = new Map<
    string,
    {
      settle: (outcome: ViewCheckOutcome) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(options: {
    ask: (request: ViewCheckRequest) => void;
    timeoutMs?: number;
    newId?: () => string;
  }) {
    this.#ask = options.ask;
    this.#timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    let counter = 0;
    this.#newId =
      options.newId ??
      (() => `view-${Date.now().toString(36)}-${(counter += 1).toString(36)}`);
  }

  async validate(kind: ViewKind, source: string): Promise<ViewCheckOutcome> {
    const id = this.#newId();

    return new Promise<ViewCheckOutcome>((resolve) => {
      const settle = (outcome: ViewCheckOutcome): void => {
        const pending = this.#waiting.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#waiting.delete(id);
        resolve(outcome);
      };

      const timer = setTimeout(() => settle(unchecked), this.#timeoutMs);
      // The timer must not hold the process open on its own; a pending check is
      // not a reason to stay alive.
      timer.unref?.();
      this.#waiting.set(id, { settle, timer });

      try {
        this.#ask({ id, kind, source });
      } catch {
        // A surface that cannot be asked is a surface that will not answer.
        settle(unchecked);
      }
    });
  }

  /**
   * An answer from the surface. Unknown ids are ignored rather than rejected:
   * a late answer to a question that already timed out, and an answer to a
   * question never asked, are indistinguishable here and neither is worth
   * failing over.
   */
  answer(requestId: string, outcome: ViewCheckOutcome): void {
    this.#waiting.get(requestId)?.settle(outcome);
  }

  /** The surface has gone. Everything still waiting on it never arrives. */
  abandon(): void {
    for (const id of [...this.#waiting.keys()])
      this.#waiting.get(id)?.settle(unchecked);
  }
}
