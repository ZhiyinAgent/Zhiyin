/** Standing instructions as saved: what was sent, and the question asked. ADR 0012. */

import { isRecord } from "./saved-values.js";

export function validStandingInstructions(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (source) =>
        isRecord(source) &&
        (source.source === "personal" || source.source === "folder") &&
        (source.path === undefined || typeof source.path === "string") &&
        typeof source.text === "string" &&
        Number.isSafeInteger(source.bytes) &&
        typeof source.truncated === "boolean",
    )
  );
}

export function validFolderInstructionsRequest(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.kind === "folderInstructions" &&
    typeof value.title === "string" &&
    typeof value.path === "string" &&
    typeof value.text === "string" &&
    typeof value.truncated === "boolean"
  );
}
