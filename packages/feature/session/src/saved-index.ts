/**
 * What the saved settings and a conversation's summary must look like to be
 * loaded. Like a conversation, anything else is treated as damaged rather than
 * trusted.
 */

import { type ConversationSummary } from "@zhiyin/contract";
import { isLookChoice, oneOf } from "@zhiyin/value-checks";
import type { SavedSettings } from "./history-store.js";
import { isFolder } from "./saved-workspace.js";
import { isRecord } from "./saved-values.js";
import { validPersonalSettings } from "./saved-settings.js";

const titleSource = oneOf<ConversationSummary["titleSource"]>({
  generated: true,
  manual: true,
});

/**
 * The settings without a look that is no longer on the list, or a strength
 * there no longer is. Looks come and go between versions, so one this version
 * does not offer is forgotten, and the default applies; a look that is not
 * shaped like one is left for the check to refuse.
 */
export function withoutUnlistedLook(settings: unknown): unknown {
  if (!isRecord(settings) || !isRecord(settings.look)) return settings;
  const { look, strength } = settings.look;
  if (typeof look !== "string" || typeof strength !== "string") return settings;
  if (isLookChoice(settings.look)) return settings;
  const forgotten: Record<string, unknown> = { ...settings };
  delete forgotten.look;
  return forgotten;
}

/** A conversation as the list shows it, without opening it. */
export function isConversationSummary(
  value: unknown,
): value is ConversationSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    titleSource(value.titleSource) &&
    typeof value.updatedAt === "string" &&
    typeof value.updatedLabel === "string"
  );
}

/** The choices a person made, in the current format. */
export function isSavedSettings(value: unknown): value is SavedSettings {
  if (!isRecord(value) || !validPersonalSettings(value)) return false;
  if (value.workspace !== undefined && !isFolder(value.workspace)) return false;
  if (
    value.launchFolders !== undefined &&
    (!Array.isArray(value.launchFolders) ||
      !value.launchFolders.every((path) => typeof path === "string"))
  )
    return false;
  if (
    !Array.isArray(value.recentWorkspaces) ||
    !value.recentWorkspaces.every(isFolder)
  )
    return false;
  return (
    value.selectedTaskId === null || typeof value.selectedTaskId === "string"
  );
}
