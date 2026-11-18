/**
 * What an edit left in a file, as the model is shown it: each line it wrote,
 * numbered as read_file numbers it, with a line of the file around each, so
 * the model sees what landed without reading the file again.
 */

import { diffLines } from "@zhiyin/text-diff";
import { shortened } from "@zhiyin/text-and-names";

/** Lines shown of one file's result, context included. */
const maximumShown = 40;
/** Characters shown of one line. */
const maximumLineLength = 200;
const around = 1;

export type EditedLines = {
  /** The lines shown, "12→text", a gap between pieces marked "…". */
  readonly lines: string;
  /** Lines the edit wrote that are not shown. */
  readonly notShown: number;
  /** A line break the edit added or removed at the end of the file, which no line shows. */
  readonly finalBreak?: "added" | "removed";
};

export function editedLines(before: string, after: string): EditedLines {
  const afterLines = after.split("\n");
  // A last line break ends the last line; it does not begin another.
  if (afterLines.length > 1 && afterLines.at(-1) === "") afterLines.pop();
  const written = new Set<number>();
  /** Lines beside a removal, where nothing new was written. */
  const beside = new Set<number>();
  let previous = 0;
  for (const section of diffLines(before, after).sections) {
    if (section.kind !== "lines") continue;
    for (const line of section.lines) {
      if (line.kind === "added" && line.afterLine) written.add(line.afterLine);
      else if (line.kind === "removed") {
        if (previous) beside.add(previous);
        beside.add(previous + 1);
      }
      if (line.afterLine) previous = line.afterLine;
    }
  }
  const ends = (text: string) => text.endsWith("\n");
  const finalBreak =
    ends(before) === ends(after)
      ? undefined
      : ends(after)
        ? ("added" as const)
        : ("removed" as const);
  if (finalBreak) beside.add(afterLines.length);
  const wanted = new Set<number>();
  for (const line of written)
    for (let near = line - around; near <= line + around; near += 1)
      if (near >= 1 && near <= afterLines.length) wanted.add(near);
  for (const line of beside)
    if (line >= 1 && line <= afterLines.length) wanted.add(line);
  const order = [...wanted].sort((left, right) => left - right);
  const shown: string[] = [];
  let shownWritten = 0;
  let last = 0;
  for (const number of order) {
    if (shown.length >= maximumShown) break;
    if (last && number > last + 1) {
      if (shown.length + 1 >= maximumShown) break;
      shown.push("…");
    }
    const text = afterLines[number - 1] ?? "";
    shown.push(`${number}→${shortened(text, maximumLineLength)}`);
    if (written.has(number)) shownWritten += 1;
    last = number;
  }
  return {
    lines: shown.join("\n"),
    notShown: written.size - shownWritten,
    ...(finalBreak ? { finalBreak } : {}),
  };
}
