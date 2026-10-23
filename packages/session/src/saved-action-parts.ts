/**
 * The parts of an action, and of an approval request, that say who allowed
 * it, which files were copied first, what a command changed and what was
 * called. The window draws each without checking it again, so one in the
 * wrong shape would reach the interface as a crash rather than as damage.
 */

import {
  oneOf,
  type ActionApproval,
  type CommandFileChange,
  type CommandFileChanges,
} from "@zhiyin/contract";
import { listOf } from "./saved-records.js";
import { isRecord, optionalText } from "./saved-values.js";

const approvalBy = oneOf<ActionApproval["by"]>({
  you: true,
  "conversation-permission": true,
  "no-approval-needed": true,
  blocked: true,
});

const protection = oneOf<"protected" | "unprotected">({
  protected: true,
  unprotected: true,
});

const commandChange = oneOf<CommandFileChange["change"]>({
  created: true,
  updated: true,
  deleted: true,
});

const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const optionalTrue = (value: unknown) =>
  value === undefined || value === true;

export function validApproval(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      approvalBy(value.by) &&
      typeof value.at === "string" &&
      optionalText(value.permissionId) &&
      optionalText(value.label) &&
      optionalText(value.reason))
  );
}

/** Which files were copied before a change, as an action or approval holds it. */
export function validRecovery(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      listOf(
        value.files,
        (file) =>
          isRecord(file) &&
          typeof file.path === "string" &&
          protection(file.status) &&
          optionalText(file.reason),
      ))
  );
}

/** How each status of what a command changed is checked; one per status. */
const commandChanges: {
  readonly [Status in CommandFileChanges["status"]]: (
    changes: Record<string, unknown>,
  ) => boolean;
} = {
  checked: (changes) =>
    listOf(
      changes.files,
      (file) =>
        isRecord(file) &&
        typeof file.path === "string" &&
        commandChange(file.change),
    ) &&
    (changes.more === undefined || count(changes.more)) &&
    optionalText(changes.job),
  running: (changes) => typeof changes.job === "string",
  unchecked: (changes) => typeof changes.reason === "string",
};

export function validCommandChanges(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || typeof value.status !== "string") return false;
  const shape = Object.hasOwn(commandChanges, value.status)
    ? commandChanges[value.status as CommandFileChanges["status"]]
    : undefined;
  return shape !== undefined && shape(value);
}

export function validInvocation(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      typeof value.name === "string" &&
      optionalText(value.via) &&
      listOf(
        value.arguments,
        (argument) =>
          isRecord(argument) &&
          typeof argument.name === "string" &&
          typeof argument.value === "string" &&
          optionalText(argument.described) &&
          optionalTrue(argument.readable) &&
          optionalTrue(argument.runs) &&
          (argument.omitted === undefined || count(argument.omitted)),
      ))
  );
}
