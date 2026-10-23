/**
 * What a saved conversation's other records must look like: what the model
 * was sent, messages waiting to be delivered, attachments, the permissions a
 * person granted, running jobs, activated plugins and undone turns.
 */

import {
  byKind,
  oneOf,
  type ConversationPermission,
  type MessageAttachment,
  type ModelHistoryEntry,
  type TaskGuidance,
  type TaskUndo,
} from "@zhiyin/contract";
import { isRecord, optionalText } from "./saved-values.js";

const guidanceStatus = oneOf<TaskGuidance["status"]>({
  pending: true,
  draft: true,
});
const permissionKind = oneOf<ConversationPermission["kind"]>({
  "file-folder": true,
  "connector-tool": true,
});
const undoneFileStatus = oneOf<TaskUndo["files"][number]["status"]>({
  restored: true,
  removed: true,
  conflict: true,
  unprotected: true,
});

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

/**
 * What a model's turn keeps beside its words: its reasoning, and the record
 * its provider needs back, which only the model client reads.
 */
function validTurnExtras(value: Record<string, unknown>): boolean {
  return (
    optionalText(value.reasoning) &&
    (value.replay === undefined ||
      (isRecord(value.replay) &&
        text(value.replay.provider) &&
        text(value.replay.format)))
  );
}

const historyEntry = byKind<ModelHistoryEntry["kind"]>({
  message: (entry) =>
    text(entry.messageId) &&
    (entry.picturesLetGo === undefined || entry.picturesLetGo === true) &&
    validTurnExtras(entry),
  calls: (entry) =>
    optionalText(entry.messageId) &&
    validTurnExtras(entry) &&
    text(entry.text) &&
    listOf(
      entry.calls,
      (call) =>
        isRecord(call) &&
        text(call.id) &&
        text(call.name) &&
        text(call.arguments),
    ),
  result: (entry) =>
    text(entry.callId) && text(entry.name) && text(entry.content),
  notice: (entry) => text(entry.content) && optionalText(entry.messageId),
  pictures: (entry) =>
    text(entry.text) &&
    listOf(
      entry.pictures,
      (picture) =>
        isRecord(picture) && text(picture.mediaType) && text(picture.source),
    ),
});

/** One entry of what the model has been sent, in the shape its kind has. */
export function validModelHistoryEntry(value: unknown): boolean {
  return isRecord(value) && text(value.id) && historyEntry(value);
}

const attachment = byKind<MessageAttachment["kind"]>({
  pastedText: (value) => count(value.bytes) && count(value.lines),
  picture: (value) =>
    text(value.name) &&
    text(value.mediaType) &&
    count(value.bytes) &&
    optionalText(value.source),
});

/** A long paste or a picture the person attached to a message. */
export function validAttachment(value: unknown): boolean {
  return isRecord(value) && text(value.id) && attachment(value);
}

/** A message sent during a turn, waiting for a safe boundary or kept as a draft. */
export function validGuidance(value: unknown): boolean {
  return (
    isRecord(value) &&
    text(value.id) &&
    text(value.text) &&
    guidanceStatus(value.status) &&
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
    permissionKind(value.kind) &&
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
        undoneFileStatus(file.status) &&
        optionalText(file.reason),
    )
  );
}

/** A plugin activated in the conversation, by id. */
export function validPluginId(value: unknown): boolean {
  return text(value);
}
