import { utf8Bytes } from "@zhiyin/context-budget";

/**
 * A text cut to its first `maximum` characters, marked with "…" where it was
 * cut; a text that fits is given as it is.
 */
export function shortened(text: string, maximum: number): string {
  return text.length > maximum
    ? `${text.slice(0, Math.max(maximum, 0))}…`
    : text;
}

/** Where the longest start of `text` within `bytes` of UTF-8 ends. */
function startWithin(text: string, bytes: number): number {
  let used = 0;
  let end = 0;
  for (const character of text) {
    used += utf8Bytes(character);
    if (used > bytes) break;
    end += character.length;
  }
  return end;
}

/** Where the longest end of `text` within `bytes` of UTF-8 starts. */
function endWithin(text: string, bytes: number): number {
  let used = 0;
  let start = text.length;
  while (start > 0) {
    const low = text.charCodeAt(start - 1);
    const pair =
      start > 1 &&
      (low & 0xfc00) === 0xdc00 &&
      (text.charCodeAt(start - 2) & 0xfc00) === 0xd800;
    const from = pair ? start - 2 : start - 1;
    used += utf8Bytes(text.slice(from, start));
    if (used > bytes) break;
    start = from;
  }
  return start;
}

/**
 * A text's start and its end, each at most `edgeBytes` in UTF-8, with
 * `between` in place of the middle. Each is cut between characters, never
 * inside one. A text whose two ends would meet has no middle to leave out,
 * and is given as it is.
 */
export function startAndEnd(
  text: string,
  edgeBytes: number,
  between: string,
): string {
  const start = startWithin(text, edgeBytes);
  const end = endWithin(text, edgeBytes);
  return start >= end
    ? text
    : `${text.slice(0, start)}${between}${text.slice(end)}`;
}
