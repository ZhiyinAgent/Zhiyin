/**
 * The choices a person makes for every conversation, saved with the history:
 * what they said at onboarding, the default context budget, their own
 * standing instructions, their answer about each folder's AGENTS.md (ADR
 * 0012), whether they may be notified outside the window, when long tasks
 * stop to ask, whether the window is light or dark, and how spelling is
 * checked.
 */

import type { TurnHost } from "@zhiyin/agent-loop";
import {
  defaultWorkPauses,
  type Appearance,
  type ContextBudgetChoice,
  type SpellingChoice,
  type FolderInstructionsChoice,
  type WorkPauses,
  type WorkspaceSnapshot,
} from "@zhiyin/contract";

/** Folders whose answer is kept; the oldest is forgotten, and asked again. */
const keptFolders = 200;

type Saved = Pick<
  WorkspaceSnapshot,
  | "preferences"
  | "contextBudget"
  | "personalInstructions"
  | "notifications"
  | "workPauses"
  | "appearance"
  | "spellingChoice"
  | "folderInstructionChoices"
>;

export class PersonalChoices {
  /** Onboarding's answers, set by `configureProfile` in startup. */
  preferences: WorkspaceSnapshot["preferences"];
  #contextBudget: ContextBudgetChoice | undefined;
  #personal: string | undefined;
  #notifications: "off" | undefined;
  #workPauses: WorkPauses | undefined;
  #appearance: Saved["appearance"];
  #spelling: SpellingChoice | undefined;
  #folders: FolderInstructionsChoice[] = [];
  readonly #changed: () => Promise<void>;

  /** `changed` saves the choices and tells the window. */
  constructor(changed: () => Promise<void>) {
    this.#changed = changed;
  }

  restore(saved: {
    readonly [Key in keyof Saved]?: Saved[Key] | undefined;
  }): void {
    this.preferences = saved.preferences;
    this.#contextBudget = saved.contextBudget;
    this.#personal = saved.personalInstructions;
    this.#notifications = saved.notifications;
    this.#workPauses = saved.workPauses;
    this.#appearance = saved.appearance;
    this.#spelling = saved.spellingChoice;
    this.#folders = [...(saved.folderInstructionChoices ?? [])];
  }

  snapshot(): Saved {
    return {
      ...(this.preferences ? { preferences: this.preferences } : {}),
      ...(this.#contextBudget ? { contextBudget: this.#contextBudget } : {}),
      ...(this.#personal ? { personalInstructions: this.#personal } : {}),
      ...(this.#notifications ? { notifications: this.#notifications } : {}),
      ...(this.#workPauses ? { workPauses: this.#workPauses } : {}),
      ...(this.#appearance ? { appearance: this.#appearance } : {}),
      ...(this.#spelling ? { spellingChoice: this.#spelling } : {}),
      ...(this.#folders.length
        ? { folderInstructionChoices: this.#folders }
        : {}),
    };
  }

  async setDefaultContextBudget(budget: ContextBudgetChoice): Promise<void> {
    this.#contextBudget = budget;
    await this.#changed();
  }

  async setPersonalInstructions(text: string): Promise<void> {
    this.#personal = text.trim() ? text : undefined;
    await this.#changed();
  }

  /** On unless the person turned them off. */
  notifies(): boolean {
    return this.#notifications !== "off";
  }

  async setNotifications(enabled: boolean): Promise<void> {
    this.#notifications = enabled ? undefined : "off";
    await this.#changed();
  }

  /** Kept only where it differs from the defaults, so a change to them reaches it. */
  async setWorkPauses(pauses: WorkPauses): Promise<void> {
    const changed = (
      Object.keys(defaultWorkPauses) as (keyof WorkPauses)[]
    ).some((name) => pauses[name] !== defaultWorkPauses[name]);
    this.#workPauses = changed ? { ...pauses } : undefined;
    await this.#changed();
  }

  appearance(): Appearance {
    return this.#appearance ?? "system";
  }

  async setAppearance(appearance: Appearance): Promise<void> {
    this.#appearance = appearance === "system" ? undefined : appearance;
    await this.#changed();
  }

  /** Absent until the person changes it: the defaults apply. */
  spelling(): SpellingChoice | undefined {
    return this.#spelling;
  }

  async setSpelling(choice: SpellingChoice): Promise<void> {
    this.#spelling = {
      enabled: choice.enabled,
      languages: [...choice.languages],
    };
    await this.#changed();
  }

  forTurns(): Pick<
    TurnHost,
    | "defaultContextBudget"
    | "personalInstructions"
    | "workPauses"
    | "folderInstructionsChoice"
    | "rememberFolderInstructions"
  > {
    return {
      defaultContextBudget: () => this.#contextBudget ?? "medium",
      personalInstructions: () => this.#personal,
      workPauses: () => this.#workPauses ?? defaultWorkPauses,
      folderInstructionsChoice: (root, hash) =>
        this.#folders.find(
          (choice) => choice.root === root && choice.hash === hash,
        )?.use,
      // One answer per folder: a changed file is asked about again anyway.
      rememberFolderInstructions: async (root, hash, use) => {
        this.#folders = [
          { root, hash, use },
          ...this.#folders.filter((choice) => choice.root !== root),
        ].slice(0, keptFolders);
        await this.#changed();
      },
    };
  }
}
