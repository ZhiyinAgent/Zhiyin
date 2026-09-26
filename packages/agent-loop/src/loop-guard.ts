/**
 * Notices a turn going in circles. ADR 0052.
 *
 * A model that repeats the same call learns nothing new from it, and without
 * this it ran until the work budget stopped it and asked the person a question
 * they could not judge. Two signals, each counted within one turn:
 *
 * - the same tool, with the same input, coming back the same way three times;
 * - the same tool failing for the same reason three times in a row.
 *
 * Either sends the model one `loop` notice naming what it repeated. A change
 * to the workspace that succeeded is progress, and starts the count again. At
 * most two notices a turn; past that the work budget takes over, and its
 * question says why.
 */

import type { ModelHistory } from "./model-history.js";

/** Occurrences of the same call, or failures in a row, that make a loop. */
export const repeatsForLoop = 3;

/** Loop notices one turn may send. */
export const noticesPerTurn = 2;

/** Arguments with their keys in a stable order, so equal input compares equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** A failure's reason with its numbers taken out, so retries of one failure match. */
function failureClass(reason: string): string {
  return reason.replace(/\d+/g, "#").slice(0, 160);
}

export class LoopGuard {
  /** How often each call came back the same way, this turn. */
  readonly #seen = new Map<string, number>();
  /** Where each call's count stood when it was last noticed. */
  readonly #noticed = new Map<string, number>();
  #failures: { readonly key: string; count: number } | undefined;
  #sent = 0;
  #pending: string | undefined;
  /** The worst repetition seen, for the work-budget question. */
  #repeated: { readonly tool: string; count: number } | undefined;

  /**
   * One call's outcome. `changed` marks a workspace change that succeeded; a
   * quiet correction is the model fixing its input, and is not counted.
   */
  observe(
    tool: string,
    args: unknown,
    call: {
      readonly result: { readonly ok: boolean; readonly reason?: string };
      readonly quiet?: boolean;
      readonly changed?: boolean;
    },
  ): void {
    const { result } = call;
    if (call.quiet) return;
    if (call.changed) {
      this.#seen.clear();
      this.#noticed.clear();
      this.#failures = undefined;
      return;
    }
    const outcome = result.ok
      ? "ok"
      : `failed:${failureClass(result.reason ?? "")}`;
    const fingerprint = `${tool}\u0000${canonical(args)}\u0000${outcome}`;
    const times = (this.#seen.get(fingerprint) ?? 0) + 1;
    this.#seen.set(fingerprint, times);
    if (!this.#repeated || times >= this.#repeated.count)
      this.#repeated = { tool, count: times };

    const failureKey = `${tool}\u0000${outcome}`;
    this.#failures = result.ok
      ? undefined
      : this.#failures?.key === failureKey
        ? { key: failureKey, count: this.#failures.count + 1 }
        : { key: failureKey, count: 1 };

    if (times - (this.#noticed.get(fingerprint) ?? 0) >= repeatsForLoop) {
      this.#noticed.set(fingerprint, times);
      this.#flag(
        `You have called ${tool} with the same input ${times} times this turn, and it answered the same way each time. Calling it again will not change the answer.`,
      );
    } else if ((this.#failures?.count ?? 0) >= repeatsForLoop) {
      this.#failures = undefined;
      this.#flag(
        `${tool} has failed the same way ${repeatsForLoop} times in a row: ${result.reason ?? "no reason given"}`,
      );
    }
  }

  /** Sends the notice pending, once, before the next request. */
  async tell(history: ModelHistory): Promise<void> {
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending) await history.notice("loop", pending);
  }

  /** Why the work may be going nowhere, when a loop notice was sent. */
  reason(): string | undefined {
    return this.#sent &&
      this.#repeated &&
      this.#repeated.count >= repeatsForLoop
      ? `The assistant repeated the same ${this.#repeated.tool} call ${this.#repeated.count} times.`
      : undefined;
  }

  #flag(what: string): void {
    if (this.#sent >= noticesPerTurn) return;
    this.#sent += 1;
    this.#pending = `${what} Change your approach, or ask the person with ask_user if you are stuck.`;
  }
}
