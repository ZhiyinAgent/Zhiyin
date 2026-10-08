/**
 * What a saved conversation's other records must look like: what the model
 * was sent, messages waiting to be delivered, attachments, the permissions a
 * person granted, running jobs, activated plugins and undone turns.
 */

import { isRecord, optionalText } from "./saved-values.js";

/** A list whose every entry passes `valid`. */
export function listOf(
  value: unknown,
  valid: (entry: unknown) => boolean,
): boolean {
  return Array.isArray(value) && value.every(valid);
}

function text(value: unknown): value is string {
  return typeof value === "string";
}

function count(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** One entry of what the model has been sent, in any of its five kinds. */
export function validModelHistoryEntry(value: unknown): boolean {
  if (!isRecord(value) || !text(value.id)) return false;
  switch (value.kind) {
    case "message":
      return (
        text(value.messageId) &&
        (value.picturesLetGo === undefined || value.picturesLetGo === true)
      );
    case "calls":
      return (
        optionalText(value.messageId) &&
        text(value.text) &&
        listOf(
          value.calls,
          (call) =>
            isRecord(call) &&
            text(call.id) &&
            text(call.name) &&
            text(call.arguments),
        )
      );
    case "result":
      return text(value.callId) && text(value.name) && text(value.content);
    case "notice":
      return text(value.content) && optionalText(value.messageId);
    case "pictures":
      return (
        text(value.text) &&
        listOf(
          value.pictures,
          (picture) =>
            isRecord(picture) &&
            text(picture.mediaType) &&
            text(picture.source),
        )
      );
    default:
      return false;
  }
}

/** A long paste or a picture the person attached to a message. */
export function validAttachment(value: unknown): boolean {
  if (!isRecord(value) || !text(value.id)) return false;
  if (value.kind === "pastedText")
    return count(value.bytes) && count(value.lines);
  return (
    value.kind === "picture" &&
    text(value.name) &&
    text(value.mediaType) &&
    count(value.bytes) &&
    optionalText(value.source)
  );
}

/** A message sent during a turn, waiting for a safe boundary or kept as a draft. */
export function validGuidance(value: unknown): boolean {
  return (
    isRecord(value) &&
    text(value.id) &&
    text(value.text) &&
    (value.status === "pending" || value.status === "draft") &&
    (value.attachments === undefined ||
      listOf(value.attachments, validAttachment))
  );
}

/** A permission the person granted for the rest of a conversation. */
export function validConversationPermission(value: unknown): boolean {
  return (
    isRecord(value) &&
    text(value.id) &&
    text(value.label) &&
    text(value.at) &&
    (value.kind === "file-folder" || value.kind === "connector-tool") &&
    text(value.toolName) &&
    optionalText(value.workspaceRoot) &&
    optionalText(value.folder) &&
    optionalText(value.identity)
  );
}

/** A command that was running as a job when the conversation was saved. */
export function validRunningJob(value: unknown): boolean {
  return isRecord(value) && text(value.id) && text(value.command);
}

/** A turn whose file changes the person undid, and what became of each file. */
export function validUndo(value: unknown): boolean {
  return (
    isRecord(value) &&
    text(value.id) &&
    text(value.messageId) &&
    listOf(value.actionIds, text) &&
    text(value.at) &&
    (value.told === undefined || value.told === true) &&
    listOf(
      value.files,
      (file) =>
        isRecord(file) &&
        text(file.path) &&
        ["restored", "removed", "conflict", "unprotected"].includes(
          String(file.status),
        ) &&
        optionalText(file.reason),
    )
  );
}

/** A plugin activated in the conversation, by id. */
export function validPluginId(value: unknown): boolean {
  return text(value);
}
