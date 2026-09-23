/**
 * What the saved list of conversations must look like to be loaded. Like a
 * conversation, anything else is treated as damaged rather than trusted.
 */

import type { SavedIndex } from "./history-store.js";
import { isFolder, isRecord, optionalText } from "./saved-workspace.js";

/** A conversation as the list shows it, without opening it. */
function isConversationSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (value.titleSource === undefined ||
      value.titleSource === "generated" ||
      value.titleSource === "manual") &&
    (value.updatedAt === undefined || typeof value.updatedAt === "string") &&
    optionalText(value.updatedLabel)
  );
}

/** The list of conversations and the choices a person made. */
export function isSavedIndex(
  value: unknown,
): value is SavedIndex & { readonly version: 2 } {
  if (!isRecord(value)) return false;
  if (value.version !== 2) return false;
  if (
    value.preferences !== undefined &&
    (!isRecord(value.preferences) ||
      typeof value.preferences.onboarded !== "boolean" ||
      !Array.isArray(value.preferences.interests) ||
      !value.preferences.interests.every((item) => typeof item === "string") ||
      (value.preferences.capabilitiesApplied !== undefined &&
        typeof value.preferences.capabilitiesApplied !== "boolean"))
  )
    return false;
  if (value.workspace !== undefined && !isFolder(value.workspace)) return false;
  if (
    value.recentWorkspaces !== undefined &&
    (!Array.isArray(value.recentWorkspaces) ||
      !value.recentWorkspaces.every(isFolder))
  )
    return false;
  if (!Array.isArray(value.conversations)) return false;
  if (value.selectedTaskId !== null && typeof value.selectedTaskId !== "string")
    return false;
  if (
    new Set(
      value.conversations.map((item) => (isRecord(item) ? item.id : undefined)),
    ).size !== value.conversations.length
  )
    return false;
  return value.conversations.every(isConversationSummary);
}
