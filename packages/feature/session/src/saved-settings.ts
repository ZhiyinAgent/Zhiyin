/**
 * The person's settings as the history keeps them: one record names each
 * setting with its check. A setting the contract gains without a check here
 * fails to compile, and what is saved, what is read back and what recovery
 * carries over are all read from this record.
 */

import { personalSettingNames, type PersonalSettings } from "@zhiyin/contract";
import {
  isLookChoice,
  isReviewerModelChoice,
  isWorkPauses,
  oneOf,
} from "@zhiyin/value-checks";
import { isRecord } from "./saved-values.js";
import { validContextBudget } from "./saved-context.js";

const paintedAppearance = oneOf<NonNullable<PersonalSettings["appearance"]>>({
  light: true,
  dark: true,
});

/** Each setting's check, of a value that is present. */
const checks: {
  readonly [Name in keyof PersonalSettings]-?: (value: unknown) => boolean;
} = {
  contextBudget: validContextBudget,
  notifications: (value) => value === "off",
  studioReviews: (value) => value === "off",
  reviewerModel: isReviewerModelChoice,
  workPauses: isWorkPauses,
  appearance: paintedAppearance,
  look: isLookChoice,
  spellingChoice: (value) =>
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    Array.isArray(value.languages) &&
    value.languages.every((code) => typeof code === "string"),
  folderInstructionChoices: (value) =>
    Array.isArray(value) &&
    value.every(
      (choice) =>
        isRecord(choice) &&
        typeof choice.root === "string" &&
        typeof choice.hash === "string" &&
        typeof choice.use === "boolean",
    ),
  preferences: (value) =>
    isRecord(value) &&
    typeof value.onboarded === "boolean" &&
    Array.isArray(value.interests) &&
    value.interests.every((item) => typeof item === "string") &&
    (value.capabilitiesApplied === undefined ||
      typeof value.capabilitiesApplied === "boolean"),
};

/** Every personal setting's name. */
export const personalSettings = Object.values(personalSettingNames);

/** Whether every personal setting `value` holds is sound. */
export function validPersonalSettings(value: Record<string, unknown>): boolean {
  return personalSettings.every(
    (name) => value[name] === undefined || checks[name](value[name]),
  );
}

/** Each personal setting `value` holds, and nothing else. */
export function personalSettingsOf(value: PersonalSettings): PersonalSettings {
  return Object.fromEntries(
    personalSettings.flatMap((name) =>
      value[name] === undefined ? [] : [[name, value[name]]],
    ),
  );
}
