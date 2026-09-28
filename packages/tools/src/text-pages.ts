/**
 * A text file read a page at a time, each line numbered, so any part of it can
 * be asked for by line and nothing is silently left out of the middle.
 *
 * A page is bounded twice, by lines and by estimated tokens, so it costs about
 * the same in every language: 60,000 characters of Chinese is four times the
 * tokens of the same length of English. The file is streamed, so its size
 * decides how long a read takes, never how much memory it holds.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { estimatedTokens } from "@zhiyin/contract";

/** The most lines one read returns when the model does not say. */
export const pageLines = 2_000;
/** The most one read returns, about what the references return. */
export const pageTokens = 8_000;
/** A line past this is cut, and says so: minified code is one line. */
const lineCharacters = 2_000;
/** Kept for the note saying where the next page starts, and any notice. */
const reservedTokens = 120;

export type Page = {
  /** The numbered lines, then where the rest continues when it does. */
  readonly text: string;
  /** The same lines without numbers, as a person reads them. */
  readonly plain: string;
  readonly first: number;
  readonly last: number;
  readonly totalLines: number;
  /** A shortened line is not a complete read of that line. */
  readonly cutLines: boolean;
};

function cut(line: string): string {
  return line.length > lineCharacters
    ? `${line.slice(0, lineCharacters)} … ${(line.length - lineCharacters).toLocaleString("en-US")} more characters on this line`
    : line;
}

export async function readPage(
  path: string,
  startLine: number,
  lineCount: number,
  signal?: AbortSignal,
  notice = "",
): Promise<Page> {
  const budget = pageTokens - reservedTokens - estimatedTokens(notice);
  const numbered: string[] = [];
  const plain: string[] = [];
  let bytes = 0;
  let full = false;
  let total = 0;
  let cutLines = false;
  const lines = createInterface({
    input: createReadStream(path, {
      encoding: "utf8",
      ...(signal ? { signal } : {}),
    }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    total += 1;
    if (total < startLine || full) continue;
    const shown = cut(line);
    const entry = `${total}→${shown}`;
    const cost = Buffer.byteLength(entry, "utf8") + 1;
    if (numbered.length && Math.ceil((bytes + cost) / 3) > budget) {
      full = true;
      continue;
    }
    numbered.push(entry);
    plain.push(shown);
    if (shown !== line) cutLines = true;
    bytes += cost;
    if (numbered.length >= lineCount) full = true;
  }
  const last = startLine + numbered.length - 1;
  const rest =
    numbered.length && last < total
      ? `\n… lines ${last + 1}–${total.toLocaleString("en-US")} not shown; call read_file with startLine=${last + 1}`
      : "";
  return {
    text: `${notice}${numbered.join("\n")}${rest}`,
    plain: plain.join("\n"),
    first: startLine,
    last,
    totalLines: total,
    cutLines,
  };
}
