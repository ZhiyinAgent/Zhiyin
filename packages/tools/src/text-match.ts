/**
 * Finding a block of text in a file the way a person means it, not the way the
 * bytes happen to be arranged.
 *
 * A model proposes an edit from what it read; the file on disk carries the
 * conventions of whatever wrote it. On Windows those disagree constantly — the
 * file has CRLF, the proposal has LF; the file may carry a byte-order mark; an
 * editor may have left trailing spaces the model dropped; the model may have
 * re-indented a block while quoting it. None of those are disagreements about
 * *which text* is meant, so none of them should fail an edit.
 *
 * What is deliberately not tolerated is a disagreement about content. Matching
 * stops at whitespace: if the words differ, the edit fails and says so, because
 * the alternative is quietly changing text nobody proposed changing.
 */

const maximumSearchLines = 20_000;
const maximumPatternLines = 500;
const minimumNearMissScore = 0.34;

type LineEnding = "\r\n" | "\n" | "\r";

/**
 * A file's content separated from the conventions it is stored with, so
 * matching never has to think about them and writing always restores them.
 */
export type DecodedText = {
  /** Line endings normalized to "\n", byte-order mark removed. */
  readonly text: string;
  readonly ending: LineEnding;
  readonly byteOrderMark: boolean;
  /** True when the file mixed endings; restoring then settles on `ending`. */
  readonly mixedEndings: boolean;
};

export function decodeText(raw: string): DecodedText {
  const byteOrderMark = raw.startsWith("\uFEFF");
  const body = byteOrderMark ? raw.slice(1) : raw;
  const crlf = (body.match(/\r\n/g) ?? []).length;
  const bareLf = (body.match(/(?<!\r)\n/g) ?? []).length;
  const bareCr = (body.match(/\r(?!\n)/g) ?? []).length;
  const ending: LineEnding =
    crlf >= bareLf && crlf >= bareCr && crlf > 0
      ? "\r\n"
      : bareCr > bareLf && bareCr > 0
        ? "\r"
        : "\n";
  const distinct = [crlf, bareLf, bareCr].filter((count) => count > 0).length;
  return {
    text: body.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
    ending,
    byteOrderMark,
    mixedEndings: distinct > 1,
  };
}

/** Puts back exactly the conventions `decodeText` took off. */
export function encodeText(decoded: DecodedText, text: string): string {
  const body =
    decoded.ending === "\n" ? text : text.replaceAll("\n", decoded.ending);
  return decoded.byteOrderMark ? `\uFEFF${body}` : body;
}

/** Line endings only. Used for text that arrives from a model, not a file. */
export function normalizeEndings(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function leadingWhitespace(line: string): string {
  return line.slice(0, line.length - line.trimStart().length);
}

/**
 * The shared indentation of a block, ignoring blank lines. Used both to compare
 * two blocks independently of how far each is indented, and to put the file's
 * own indentation back on a replacement.
 */
function commonIndent(lines: readonly string[]): string {
  let indent: string | undefined;
  for (const line of lines) {
    if (isBlank(line)) continue;
    const current = leadingWhitespace(line);
    if (indent === undefined) {
      indent = current;
      continue;
    }
    let shared = 0;
    while (
      shared < indent.length &&
      shared < current.length &&
      indent[shared] === current[shared]
    )
      shared += 1;
    indent = indent.slice(0, shared);
  }
  return indent ?? "";
}

function dedent(lines: readonly string[]): string[] {
  const indent = commonIndent(lines);
  return lines.map((line) =>
    isBlank(line) ? "" : line.slice(indent.length).trimEnd(),
  );
}

type NearMiss = {
  /** 1-based, for a person or a model to look at. Never file content. */
  readonly line: number;
  /** 0 to 1. How much of the proposed block that region shares. */
  readonly score: number;
};

export type TextMatch =
  /** Character offsets: the proposed text is present verbatim. */
  | { readonly kind: "exact"; readonly offsets: readonly number[] }
  /**
   * Line indices: the proposed text is present as whole lines, differing only
   * in indentation and trailing whitespace. Flexible matching works on whole
   * lines, so it never matches part of a line the way exact matching can.
   */
  | {
      readonly kind: "flexible";
      readonly lines: readonly number[];
      readonly lineCount: number;
    }
  | { readonly kind: "none"; readonly nearest?: NearMiss }
  | { readonly kind: "unsearchable"; readonly reason: string };

function windowMatches(
  haystack: readonly string[],
  needle: readonly string[],
  start: number,
): boolean {
  const window = haystack.slice(start, start + needle.length);
  if (window.length !== needle.length) return false;
  const dedented = dedent(window);
  return needle.every((line, index) => dedented[index] === line);
}

function nearestMiss(
  haystack: readonly string[],
  needle: readonly string[],
): NearMiss | undefined {
  let best: NearMiss | undefined;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    const dedented = dedent(haystack.slice(start, start + needle.length));
    let shared = 0;
    for (let index = 0; index < needle.length; index += 1)
      if (dedented[index] === needle[index]) shared += 1;
    const score = shared / needle.length;
    if (score > (best?.score ?? 0)) best = { line: start + 1, score };
  }
  return best && best.score >= minimumNearMissScore ? best : undefined;
}

/**
 * Locates `pattern` inside `text`, both already normalized to "\n".
 *
 * Exact matching is tried first and, when it finds anything, is the answer —
 * so a file that genuinely contains the proposed text is never reinterpreted.
 * Only when nothing matches exactly does the flexible pass run, comparing the
 * two blocks with trailing whitespace removed and their own indentation taken
 * off, which is what makes a re-indented or re-wrapped proposal still land.
 */
export function findText(text: string, pattern: string): TextMatch {
  if (!pattern) return { kind: "none" };

  const exact: number[] = [];
  for (
    let index = text.indexOf(pattern);
    index !== -1;
    index = text.indexOf(pattern, index + 1)
  )
    exact.push(index);
  if (exact.length) return { kind: "exact", offsets: exact };

  const haystack = text.split("\n");
  const needle = dedent(pattern.split("\n"));
  // A pattern ending in a newline produces a trailing empty line that is an
  // artifact of splitting, not a line the file has to contain.
  while (needle.length > 1 && needle.at(-1) === "") needle.pop();
  if (
    haystack.length > maximumSearchLines ||
    needle.length > maximumPatternLines
  ) {
    return {
      kind: "unsearchable",
      reason:
        "The file or the replacement is too large to search line by line. Replace a smaller, more specific piece of text.",
    };
  }

  const starts: number[] = [];
  for (let start = 0; start + needle.length <= haystack.length; start += 1)
    if (windowMatches(haystack, needle, start)) starts.push(start);
  if (starts.length)
    return { kind: "flexible", lines: starts, lineCount: needle.length };

  const nearest = nearestMiss(haystack, needle);
  return nearest ? { kind: "none", nearest } : { kind: "none" };
}

/**
 * Replaces a flexible match, wearing the indentation the file already uses
 * there rather than the indentation the proposal happened to arrive with.
 */
export function replaceLines(
  text: string,
  start: number,
  lineCount: number,
  replacement: string,
): string {
  const lines = text.split("\n");
  const indent = commonIndent(lines.slice(start, start + lineCount));
  const replacementLines = dedent(replacement.split("\n"));
  while (replacementLines.length > 1 && replacementLines.at(-1) === "")
    replacementLines.pop();
  const indented = replacementLines.map((line) =>
    line ? `${indent}${line}` : line,
  );
  return [
    ...lines.slice(0, start),
    ...indented,
    ...lines.slice(start + lineCount),
  ].join("\n");
}
