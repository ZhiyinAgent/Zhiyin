/**
 * Checking spelling as the person types: whether it is on, which languages it
 * checks, and how far each language's dictionary has got.
 */

/** A language spelling can be checked in, named as its speakers name it. */
export type SpellingLanguage = {
  /** The tag the spellchecker knows it by, such as `fr` or `en-GB`. */
  readonly code: string;
  /** In the language itself: "français". */
  readonly name: string;
  /** In English: "French". */
  readonly englishName: string;
};

/**
 * Loading until its dictionary is read; unavailable when it could not be,
 * and the other languages are still checked.
 */
export type SpellingLanguageStatus = "loading" | "ready" | "unavailable";

/** What the person chose, as saved. */
export type SpellingChoice = {
  readonly enabled: boolean;
  /** In the order chosen; at least one while spelling is checked. */
  readonly languages: readonly string[];
};

/** Spelling as it is now, for Settings to show. Never saved. */
export type SpellingState = {
  readonly enabled: boolean;
  /** The languages checked, or that would be once it is turned on. */
  readonly languages: readonly {
    readonly code: string;
    readonly status: SpellingLanguageStatus;
  }[];
  /** Every language a dictionary comes with Zhiyin for. */
  readonly offered: readonly SpellingLanguage[];
};
