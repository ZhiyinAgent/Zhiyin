/**
 * How much of a tool's answer the model is shown, and what happens to the rest.
 *
 * Every result is measured in estimated tokens before it is sent, whichever
 * tool gave it. One result may take 8k, or 5 % of the conversation's budget
 * when that is less; one round's results together, 24k or 15 %. Past either, the whole answer is kept with the conversation and the model is
 * shown its start and its end with where the whole is: `read_file` reads it
 * again a page at a time. Nothing is dropped without saying where it went.
 */

import { estimatedTokens } from "@zhiyin/contract";

export const resultTokens = 8_000;
export const roundTokens = 24_000;
/** Shown of a result past the round's limit, so it is never a bare receipt. */
const leastShownTokens = 200;
const marker = (receipt: string) => `\n… ${receipt} …\n`;

export type KeepOutput = (
  text: string,
) => Promise<
  | { readonly status: "kept"; readonly id: string; readonly bytes: number }
  | { readonly status: "refused"; readonly reason: string }
>;

export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * An answer laid out to be read a page at a time: a text field's own lines
 * kept as lines, rather than escaped onto one line that no page can show.
 */
export function laidOut(value: unknown, depth = 0): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map((item) => laidOut(item, depth + 1)).join("\n");
  if (value && typeof value === "object")
    return Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) =>
        typeof entry === "string" && !entry.includes("\n")
          ? `${key}: ${entry}`
          : typeof entry !== "object" || entry === null
            ? `${key}: ${String(entry)}`
            : `${key}:\n${laidOut(entry, depth + 1)}`,
      )
      .join("\n");
  return String(value);
}

/** The start and the end of a text, together within `tokens`. */
function ends(text: string, tokens: number, between: string): string {
  const bytes = Buffer.from(text, "utf8");
  const edge = Math.max(
    0,
    Math.floor((tokens * 3 - Buffer.byteLength(between)) / 2),
  );
  // A cut inside a character leaves a replacement mark; it is dropped.
  const head = bytes
    .subarray(0, edge)
    .toString("utf8")
    .replace(/\uFFFD$/, "");
  const tail = bytes
    .subarray(bytes.length - edge)
    .toString("utf8")
    .replace(/^\uFFFD/, "");
  return `${head}${between}${tail}`;
}

export type ResultLimits = { readonly result: number; readonly round: number };

/** The limits for a conversation kept under `targetTokens`. */
export function resultLimits(targetTokens: number): ResultLimits {
  return {
    result: Math.min(resultTokens, Math.floor(targetTokens * 0.05)),
    round: Math.min(roundTokens, Math.floor(targetTokens * 0.15)),
  };
}

/** One round's results, measured as they are added. */
export class RoundResults {
  readonly #keep: KeepOutput;
  readonly #limits: ResultLimits;
  #used = 0;

  constructor(
    keep: KeepOutput,
    limits: ResultLimits = { result: resultTokens, round: roundTokens },
  ) {
    this.#keep = keep;
    this.#limits = limits;
  }

  /**
   * What the model is shown of one answer: all of it when it fits, otherwise
   * its start and end and where the whole was kept. `whole` is the answer laid
   * out to read again; `sent` is the answer as the model would receive it.
   */
  async fit(sent: string, whole: unknown): Promise<string> {
    const allowance = Math.min(
      this.#limits.result,
      this.#limits.round - this.#used,
    );
    const tokens = estimatedTokens(sent);
    if (tokens <= allowance) {
      this.#used += tokens;
      return sent;
    }
    const kept = await this.#keep(laidOut(whole)).catch(() => ({
      status: "refused" as const,
      reason: "it could not be saved",
    }));
    const receipt =
      kept.status === "kept"
        ? `Full output (${readableSize(kept.bytes)}) saved as output://${kept.id}; read it with read_file`
        : `The rest was not kept: ${kept.reason}`;
    const shown = ends(
      sent,
      Math.max(leastShownTokens, allowance),
      marker(receipt),
    );
    this.#used += estimatedTokens(shown);
    return shown;
  }
}
