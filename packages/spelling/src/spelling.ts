/**
 * The person's choice applied to the spellchecker, and how far each language
 * has got.
 */

import type {
  SpellingChoice,
  SpellingLanguageStatus,
  SpellingState,
} from "@zhiyin/contract";
import {
  defaultLanguages,
  dictionaryOf,
  offeredLanguages,
  type BundledDictionary,
} from "./languages.js";
import type { Placement } from "./shelf.js";

/** Chromium's spellchecker, as the main process reaches it. */
export interface SpellcheckEngine {
  setEnabled(enabled: boolean): void;
  /** Reads each language's dictionary afresh, even one it had already read. */
  setLanguages(codes: readonly string[]): void;
  /** Hears each language whose dictionary was read, or could not be. */
  onLanguage(
    listener: (code: string, outcome: "ready" | "unavailable") => void,
  ): void;
}

export class Spelling {
  readonly #engine: SpellcheckEngine;
  readonly #shelf: {
    place(dictionary: BundledDictionary): Promise<Placement>;
  };
  readonly #defaults: readonly string[];
  readonly #status = new Map<string, SpellingLanguageStatus>();
  readonly #listeners = new Set<() => void>();
  #enabled = false;
  #languages: readonly string[] = [];

  constructor(options: {
    readonly engine: SpellcheckEngine;
    readonly shelf: {
      place(dictionary: BundledDictionary): Promise<Placement>;
    };
    /** Windows' languages, most preferred first. */
    readonly systemLanguages: readonly string[];
  }) {
    this.#engine = options.engine;
    this.#shelf = options.shelf;
    this.#defaults = defaultLanguages(options.systemLanguages);
    this.#engine.onLanguage((code, outcome) => {
      if (!this.#languages.includes(code)) return;
      this.#status.set(code, outcome);
      this.#changed();
    });
  }

  /** Applies the saved choice; none saved, the defaults. */
  async apply(choice: SpellingChoice | undefined): Promise<void> {
    const enabled = choice?.enabled ?? true;
    // A language with no dictionary here is not checked, nor offered.
    this.#languages = (choice?.languages ?? this.#defaults).filter((code) =>
      dictionaryOf(code),
    );
    this.#enabled = enabled;
    if (!enabled) {
      this.#engine.setEnabled(false);
      this.#changed();
      return;
    }
    // Each dictionary is in place before the spellchecker looks for it. One
    // that cannot be placed is still checked: the spellchecker fetches it if
    // it can, and says if it cannot.
    for (const code of this.#languages) {
      await this.#shelf.place(dictionaryOf(code)!).catch(() => undefined);
      // A language already ready stays ready while it is loaded again.
      if (this.#status.get(code) !== "ready") this.#status.set(code, "loading");
    }
    this.#engine.setLanguages(this.#languages);
    this.#engine.setEnabled(true);
    this.#changed();
  }

  state(): SpellingState {
    return {
      enabled: this.#enabled,
      languages: this.#languages.map((code) => ({
        code,
        status: this.#status.get(code) ?? "loading",
      })),
      offered: offeredLanguages(),
    };
  }

  /** Called whenever the state changes; returns how to stop. */
  onChanged(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
