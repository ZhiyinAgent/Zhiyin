/**
 * What the saved settings and a conversation's summary must look like to be
 * loaded. Like a conversation, anything else is treated as damaged rather than
 * trusted.
 */

import type { ConversationSummary } from "@zhiyin/contract";
import type { SavedSettings } from "./history-store.js";
import { isFolder } from "./saved-workspace.js";
import { isRecord } from "./saved-values.js";
import { validContextBudget } from "./saved-context.js";

/** A conversation as the list shows it, without opening it. */
export function isConversationSummary(
  value: unknown,
): value is ConversationSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (value.titleSource === "generated" || value.titleSource === "manual") &&
    typeof value.updatedAt === "string" &&
    typeof value.updatedLabel === "string"
  );
}

/** The choices a person made, in the current format. */
export function isSavedSettings(value: unknown): value is SavedSettings {
  if (!isRecord(value)) return false;
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
  if (!validContextBudget(value.contextBudget)) return false;
  if (
    value.personalInstructions !== undefined &&
    typeof value.personalInstructions !== "string"
  )
    return false;
  if (value.notifications !== undefined && value.notifications !== "off")
    return false;
  if (
    value.appearance !== undefined &&
    value.appearance !== "light" &&
    value.appearance !== "dark"
  )
    return false;
  if (
    value.spellingChoice !== undefined &&
    (!isRecord(value.spellingChoice) ||
      typeof value.spellingChoice.enabled !== "boolean" ||
      !Array.isArray(value.spellingChoice.languages) ||
      !value.spellingChoice.languages.every((code) => typeof code === "string"))
  )
    return false;
  if (
    value.folderInstructionChoices !== undefined &&
    (!Array.isArray(value.folderInstructionChoices) ||
      !value.folderInstructionChoices.every(
        (choice) =>
          isRecord(choice) &&
          typeof choice.root === "string" &&
          typeof choice.hash === "string" &&
          typeof choice.use === "boolean",
      ))
  )
    return false;
  if (value.workspace !== undefined && !isFolder(value.workspace)) return false;
  if (
    !Array.isArray(value.recentWorkspaces) ||
    !value.recentWorkspaces.every(isFolder)
  )
    return false;
  return (
    value.selectedTaskId === null || typeof value.selectedTaskId === "string"
  );
}
