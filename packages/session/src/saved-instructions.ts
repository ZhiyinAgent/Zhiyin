/** Standing instructions as saved: what was sent, and the question asked. ADR 0012. */

import { oneOf, type StandingInstruction } from "@zhiyin/contract";
import { isRecord } from "./saved-values.js";

const instructionSource = oneOf<StandingInstruction["source"]>({
  personal: true,
  folder: true,
});

export function validStandingInstructions(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (source) =>
        isRecord(source) &&
        instructionSource(source.source) &&
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
