/**
 * What the saved settings and a conversation's summary must look like to be
 * loaded. Like a conversation, anything else is treated as damaged rather than
 * trusted.
 */

import type { ConversationSummary } from "@zhiyin/contract";
import type { SavedSettings } from "./history-store.js";
import { isFolder, isRecord, optionalText } from "./saved-workspace.js";

/** A conversation as the list shows it, without opening it. */
export function isConversationSummary(
  value: unknown,
): value is ConversationSummary {
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

/** The choices a person made. */
export function isSavedSettings(
  value: unknown,
): value is SavedSettings & { readonly version: 3 } {
  if (!isRecord(value)) return false;
  if (value.version !== 3) return false;
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
  return (
    value.selectedTaskId === null || typeof value.selectedTaskId === "string"
  );
}
