import { bytesForTokens, utf8Bytes } from "@zhiyin/context-budget";

/** Where the last break of a kind starts in `text`, or -1. */
function lastBreak(text: string, kind: RegExp): number {
  let at = -1;
  for (const found of text.matchAll(kind)) at = found.index;
  return at;
}

/**
 * The start of a source of standing instructions that fits in `tokens`: cut
 * at the last paragraph break that fits, else the last line break, else
 * between characters, with the number of the last line kept. A break is used
 * only where it keeps at least half of what fits, so a heading over one long
 * list keeps the list. Windows line endings count as line breaks.
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
  const fits = bytesForTokens(tokens);
  if (utf8Bytes(text) <= fits) return { text, truncated: false };
  let end = 0;
  let bytes = 0;
  for (const character of text) {
    bytes += utf8Bytes(character);
    if (bytes > fits) break;
    end += character.length;
  }
  const start = text.slice(0, end);
  const half = fits / 2;
  const kept =
    [lastBreak(start, /\r?\n[ \t]*\r?\n/g), lastBreak(start, /\r?\n/g)]
      .map((at) => (at > 0 ? start.slice(0, at).trimEnd() : ""))
      .find((cut) => utf8Bytes(cut) >= half) ?? start.trimEnd();
  return { text: kept, truncated: true, lastLine: kept.split("\n").length };
}
