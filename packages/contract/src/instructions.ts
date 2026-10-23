/**
 * Standing instructions: what the person asks of every conversation, and what
 * a folder's AGENTS.md asks once they approve it. They guide style and
 * approach and never grant permission. ADR 0017.
 */

import { utf8Bytes } from "./token-estimate.js";

/** The least of one source the model is sent, in estimated tokens. */
export const leastInstructionTokens = 8_000;
/** The share of the budget one source may take, where that is more. */
const instructionShare = 0.05;
/** The largest budget there is, so the most any source is ever sent. */
const largestBudgetTokens = 1_000_000;

/**
 * How much of one source the model is sent under a budget of
 * `targetTokens`, in estimated tokens: its share of the budget, and never
 * less than the least. Counted in tokens rather than bytes, so a source
 * written in Chinese has the room the same meaning has in English.
 */
export function instructionTokens(targetTokens: number): number {
  return Math.max(
    leastInstructionTokens,
    Math.floor(targetTokens * instructionShare),
  );
}

/**
 * How much of a source a reader holds, in UTF-8 bytes: a little more than any
 * budget sends, at the three bytes a token is estimated at, so a source cut
 * there is cut again where a paragraph ends.
 */
export const longestInstructionBytes =
  instructionTokens(largestBudgetTokens) * 3 + 4;

/** Where the last break of a kind starts in `text`, or -1. */
function lastBreak(text: string, kind: RegExp): number {
  let at = -1;
  for (const found of text.matchAll(kind)) at = found.index;
  return at;
}

/**
 * The start of a source that fits in `tokens`: cut at the last paragraph
 * break that fits, else the last line break, else between characters, with
 * the number of the last line kept. A break is used only where it keeps at
 * least half of what fits, so a heading over one long list keeps the list.
 * Windows line endings count as line breaks.
 */
export function instructionCut(
  text: string,
  tokens: number,
):
  | { readonly text: string; readonly truncated: false }
  | {
      readonly text: string;
      readonly truncated: true;
      readonly lastLine: number;
    } {
  if (utf8Bytes(text) <= tokens * 3) return { text, truncated: false };
  let end = 0;
  let bytes = 0;
  for (const character of text) {
    bytes += utf8Bytes(character);
    if (bytes > tokens * 3) break;
    end += character.length;
  }
  const start = text.slice(0, end);
  const half = (tokens * 3) / 2;
  const kept =
    [lastBreak(start, /\r?\n[ \t]*\r?\n/g), lastBreak(start, /\r?\n/g)]
      .map((at) => (at > 0 ? start.slice(0, at).trimEnd() : ""))
      .find((cut) => utf8Bytes(cut) >= half) ?? start.trimEnd();
  return { text: kept, truncated: true, lastLine: kept.split("\n").length };
}

/** One source as the model was sent it. */
export type StandingInstruction = {
  readonly source: "personal" | "folder";
  /** The file's path inside the folder, for a folder's instructions. */
  readonly path?: string;
  /** The text sent: the whole source, or its start when `truncated`. */
  readonly text: string;
  /** The size of the whole source. */
  readonly bytes: number;
  readonly truncated: boolean;
};

/** What the person said about one folder's instructions, as that file read. */
export type FolderInstructionsChoice = {
  readonly root: string;
  readonly hash: string;
  readonly use: boolean;
};

/** A folder's AGENTS.md as read, with the hash its approval is kept against. */
export type FolderInstructions = {
  readonly path: string;
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly hash: string;
};
