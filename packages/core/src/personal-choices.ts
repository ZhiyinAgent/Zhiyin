/**
 * The choices a person makes for every conversation, saved with the history:
 * what they said at onboarding, the default context budget, their own
 * standing instructions, and their answer about each folder's AGENTS.md
 * (ADR 0054).
 */

import type { TurnHost } from "@zhiyin/agent-loop";
import type {
  ContextBudgetChoice,
  FolderInstructionsChoice,
  WorkspaceSnapshot,
} from "@zhiyin/contract";

/** Folders whose answer is kept; the oldest is forgotten, and asked again. */
const keptFolders = 200;

type Saved = Pick<
  WorkspaceSnapshot,
  | "preferences"
  | "contextBudget"
  | "personalInstructions"
  | "folderInstructionChoices"
>;

export class PersonalChoices {
  /** Onboarding's answers, set by `configureProfile` in startup. */
  preferences: WorkspaceSnapshot["preferences"];
  #contextBudget: ContextBudgetChoice | undefined;
  #personal: string | undefined;
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
    this.#folders = [...(saved.folderInstructionChoices ?? [])];
  }

  snapshot(): Saved {
    return {
      ...(this.preferences ? { preferences: this.preferences } : {}),
      ...(this.#contextBudget ? { contextBudget: this.#contextBudget } : {}),
      ...(this.#personal ? { personalInstructions: this.#personal } : {}),
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

  forTurns(): Pick<
    TurnHost,
    | "defaultContextBudget"
    | "personalInstructions"
    | "folderInstructionsChoice"
    | "rememberFolderInstructions"
  > {
    return {
      defaultContextBudget: () => this.#contextBudget ?? "medium",
      personalInstructions: () => this.#personal,
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
