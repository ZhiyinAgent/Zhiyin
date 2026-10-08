/**
 * Notices a turn going in circles. ADR 0013.
 *
 * A model that repeats the same call learns nothing new from it, and without
 * this it would run until the work budget stopped it and asked the person a
 * question they could not judge. Two signals, each counted within one turn:
 *
 * - the same tool, with the same input, answering exactly the same, three
 *   times in a row;
 * - the same tool failing for the same reason three times in a row.
 *
 * Only calls in a row count. The same screenshot taken after each of three
 * clicks is three looks at three pages, not a loop, and a call repeated between
 * other work is checking, not circling. The answer is compared whole, so the
 * notice's claim that the tool "answered the same way" is true when it is made.
 *
 * Either sends the model one `loop` notice naming what it repeated. A change
 * to the workspace that succeeded is progress, and starts the count again. At
 * most two notices a turn; past that the work budget takes over, and its
 * question says why.
 */

import { createHash } from "node:crypto";
import type { ModelHistory } from "../context/model-history.js";

/** Occurrences of the same call, or failures in a row, that make a loop. */
const repeatsForLoop = 3;

/** Loop notices one turn may send. */
const noticesPerTurn = 2;

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

/** What the tool answered, pictures included; the person's copy is left out. */
function answerOf(result: object): string {
  return createHash("sha256")
    .update(canonical({ ...result, details: undefined }))
    .digest("hex");
}

export class LoopGuard {
  /** The last call and how many times in a row it answered the same. */
  #streak: { readonly key: string; count: number; noticed: number } | undefined;
  #failures: { readonly key: string; count: number } | undefined;
  #sent = 0;
  #pending: string | undefined;
  /** The worst repetition seen, for the work-budget question. */
  #repeated: { readonly title?: string; count: number } | undefined;

  reset(): void {
    this.#streak = undefined;
    this.#failures = undefined;
    this.#pending = undefined;
    this.#repeated = undefined;
  }

  /**
   * One call's outcome. `changed` marks a workspace change that succeeded; a
   * quiet correction is the model fixing its input, and is not counted.
   * `title` is the step as the person's action list names it.
   */
  observe(
    tool: string,
    args: unknown,
    call: {
      readonly result: { readonly ok: boolean; readonly reason?: string };
      readonly quiet?: boolean;
      readonly changed?: boolean;
      readonly title?: string;
    },
  ): void {
    const { result } = call;
    if (call.quiet) return;
    if (call.changed) {
      this.#streak = undefined;
      this.#failures = undefined;
      return;
    }
    const outcome = result.ok
      ? `ok:${answerOf(result)}`
      : `failed:${failureClass(result.reason ?? "")}`;
    const key = `${tool}\u0000${canonical(args)}\u0000${outcome}`;
    this.#streak =
      this.#streak?.key === key
        ? { ...this.#streak, count: this.#streak.count + 1 }
        : { key, count: 1, noticed: 0 };
    const times = this.#streak.count;
    if (!this.#repeated || times >= this.#repeated.count)
      this.#repeated = call.title
        ? { title: call.title, count: times }
        : { count: times };

    const failureKey = `${tool}\u0000${result.ok ? "ok" : outcome}`;
    this.#failures = result.ok
      ? undefined
      : this.#failures?.key === failureKey
        ? { key: failureKey, count: this.#failures.count + 1 }
        : { key: failureKey, count: 1 };

    if (times - this.#streak.noticed >= repeatsForLoop) {
      this.#streak.noticed = times;
      this.#flag(
        `You have called ${tool} with the same input ${times} times in a row, and it answered exactly the same way each time. Calling it again will not change the answer.`,
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
    if (!this.#sent || !this.#repeated) return undefined;
    const { count, title } = this.#repeated;
    if (count < repeatsForLoop) return undefined;
    const step = title ? `: ${title.replace(/\.$/, "")}.` : ".";
    return `Zhiyin did the same step ${count} times in a row${step}`;
  }

  #flag(what: string): void {
    if (this.#sent >= noticesPerTurn) return;
    this.#sent += 1;
    this.#pending = `${what} Change your approach, or ask the person with ask_user if you are stuck.`;
  }
}
