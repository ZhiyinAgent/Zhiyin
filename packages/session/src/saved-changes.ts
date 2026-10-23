/**
 * The file changes an action or an approval holds, checked as the window will
 * draw them. A difference is drawn line by line without further inspection,
 * so a stored one in the wrong shape would reach the interface as a crash
 * rather than as damaged data.
 */

import {
  byKind,
  oneOf,
  type DiffLine,
  type DiffSection,
  type FileChange,
} from "@zhiyin/contract";
import { isRecord, optionalText } from "./saved-values.js";

const changeKind = oneOf<FileChange["change"]>({
  created: true,
  updated: true,
  recycled: true,
  deleted: true,
});

const lineKind = oneOf<DiffLine["kind"]>({
  same: true,
  added: true,
  removed: true,
});

const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const optionalCount = (value: unknown) => value === undefined || count(value);

function validLine(line: unknown): boolean {
  return (
    isRecord(line) &&
    lineKind(line.kind) &&
    typeof line.text === "string" &&
    optionalCount(line.beforeLine) &&
    optionalCount(line.afterLine) &&
    (line.parts === undefined ||
      (Array.isArray(line.parts) &&
        line.parts.every(
          (part) =>
            isRecord(part) &&
            typeof part.text === "string" &&
            typeof part.changed === "boolean",
        )))
  );
}

const validSection = byKind<DiffSection["kind"]>({
  lines: (section) =>
    Array.isArray(section.lines) && section.lines.every(validLine),
  skipped: (section) => count(section.count),
});

function validDiff(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      count(value.added) &&
      count(value.removed) &&
      Array.isArray(value.sections) &&
      value.sections.every(validSection))
  );
}

export function validChanges(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (change) =>
          isRecord(change) &&
          typeof change.path === "string" &&
          changeKind(change.change) &&
          optionalText(change.before) &&
          optionalText(change.after) &&
          optionalText(change.omitted) &&
          validDiff(change.diff),
      ))
  );
}
