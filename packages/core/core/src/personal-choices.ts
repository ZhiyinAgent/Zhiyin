/**
 * The choices a person makes for every conversation, saved with the history:
 * what they said at onboarding, the default context budget, their answer
 * about each folder's AGENTS.md (ADR 0013), whether they may be notified
 * outside the window, whether studio work is reviewed before a turn ends,
 * when long tasks stop to ask, whether the window is light or dark, how it
 * looks, and how spelling is checked. They are held as the contract's one
 * record of personal settings, each absent until changed.
 */

import type { TurnHost } from "@zhiyin/agent-loop";
import {
  defaultLook,
  defaultWorkPauses,
  personalSettingNames,
  type Appearance,
  type LookChoice,
  type ContextBudgetChoice,
  type PersonalSettings,
  type SpellingChoice,
  type ReviewerModelChoice,
  type WorkPauses,
} from "@zhiyin/contract";

/** Folders whose answer is kept; the oldest is forgotten, and asked again. */
const keptFolders = 200;

/** Each personal setting `source` holds, and nothing else. */
export function personalSettingsIn(source: PersonalSettings): PersonalSettings {
  return Object.fromEntries(
    Object.values(personalSettingNames).flatMap((name) =>
      source[name] === undefined ? [] : [[name, source[name]]],
    ),
  );
}

export class PersonalChoices {
  #settings: PersonalSettings = {};
  readonly #changed: () => Promise<void>;

  /** `changed` saves the choices and tells the window. */
  constructor(changed: () => Promise<void>) {
    this.#changed = changed;
  }

  restore(saved: PersonalSettings): void {
    this.#settings = personalSettingsIn(saved);
  }

  snapshot(): PersonalSettings {
    return this.#settings;
  }

  /** Onboarding's answers, set by `configureProfile` in startup. */
  get preferences(): PersonalSettings["preferences"] {
    return this.#settings.preferences;
  }

  set preferences(preferences: PersonalSettings["preferences"]) {
    this.#set("preferences", preferences);
  }

  /** Sets one setting, absent for its default, without saving it. */
  #set<Name extends keyof PersonalSettings>(
    name: Name,
    value: PersonalSettings[Name],
  ): void {
    const settings: Partial<Record<keyof PersonalSettings, unknown>> = {
      ...this.#settings,
    };
    if (value === undefined) delete settings[name];
    else settings[name] = value;
    this.#settings = settings as PersonalSettings;
  }

  /** Sets one setting and saves the choices. */
  async #change<Name extends keyof PersonalSettings>(
    name: Name,
    value: PersonalSettings[Name],
  ): Promise<void> {
    this.#set(name, value);
    await this.#changed();
  }

  setDefaultContextBudget(budget: ContextBudgetChoice): Promise<void> {
    return this.#change("contextBudget", budget);
  }

  /** On unless the person turned them off. */
  notifies(): boolean {
    return this.#settings.notifications !== "off";
  }

  setNotifications(enabled: boolean): Promise<void> {
    return this.#change("notifications", enabled ? undefined : "off");
  }

  setStudioReviews(enabled: boolean): Promise<void> {
    return this.#change("studioReviews", enabled ? undefined : "off");
  }

  /** The model chosen for reviews; nothing while it is the conversation's. */
  reviewerModel(): ReviewerModelChoice | undefined {
    return this.#settings.reviewerModel;
  }

  setReviewerModel(choice: ReviewerModelChoice | undefined): Promise<void> {
    return this.#change(
      "reviewerModel",
      choice && {
        provider: choice.provider,
        ...(choice.region ? { region: choice.region } : {}),
        model: choice.model,
        providers: [...choice.providers],
      },
    );
  }

  /** Kept only where it differs from the defaults, so a change to them reaches it. */
  setWorkPauses(pauses: WorkPauses): Promise<void> {
    const changed = (
      Object.keys(defaultWorkPauses) as (keyof WorkPauses)[]
    ).some((name) => pauses[name] !== defaultWorkPauses[name]);
    return this.#change("workPauses", changed ? { ...pauses } : undefined);
  }

  appearance(): Appearance {
    return this.#settings.appearance ?? "system";
  }

  setAppearance(appearance: Appearance): Promise<void> {
    return this.#change(
      "appearance",
      appearance === "system" ? undefined : appearance,
    );
  }

  look(): LookChoice {
    return this.#settings.look ?? defaultLook;
  }

  /** Kept only where it differs from the default, as the appearance is. */
  setLook(choice: LookChoice): Promise<void> {
    return this.#change(
      "look",
      choice.look === defaultLook.look &&
        choice.strength === defaultLook.strength
        ? undefined
        : { look: choice.look, strength: choice.strength },
    );
  }

  /** Absent until the person changes it: the defaults apply. */
  spelling(): SpellingChoice | undefined {
    return this.#settings.spellingChoice;
  }

  setSpelling(choice: SpellingChoice): Promise<void> {
    return this.#change("spellingChoice", {
      enabled: choice.enabled,
      languages: [...choice.languages],
    });
  }

  forTurns(): Pick<
    TurnHost,
    | "defaultContextBudget"
    | "workPauses"
    | "reviewsStudioWork"
    | "folderInstructionsChoice"
    | "rememberFolderInstructions"
  > {
    return {
      defaultContextBudget: () => this.#settings.contextBudget ?? "medium",
      workPauses: () => this.#settings.workPauses ?? defaultWorkPauses,
      // On unless the person turned it off.
      reviewsStudioWork: () => this.#settings.studioReviews !== "off",
      folderInstructionsChoice: (root, hash) =>
        this.#settings.folderInstructionChoices?.find(
          (choice) => choice.root === root && choice.hash === hash,
        )?.use,
      // One answer per folder: a changed file is asked about again anyway.
      rememberFolderInstructions: (root, hash, use) =>
        this.#change(
          "folderInstructionChoices",
          [
            { root, hash, use },
            ...(this.#settings.folderInstructionChoices ?? []).filter(
              (choice) => choice.root !== root,
            ),
          ].slice(0, keptFolders),
        ),
    };
  }
}
