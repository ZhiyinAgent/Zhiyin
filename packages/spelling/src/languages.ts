/**
 * The languages spelling can be checked in: one for each dictionary that comes
 * with Zhiyin, as Chromium names and versions it.
 */

import type { SpellingLanguage } from "@zhiyin/contract";
import bundle from "../dictionaries.json";

/** A dictionary as it comes with Zhiyin, and what it must hash to. */
export type BundledDictionary = {
  /** The tag the spellchecker is given for it. */
  readonly language: string;
  /** Chromium's name for it, version included. */
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
};

/** Where the dictionaries were taken from, for the licence notice. */
export const dictionarySource: {
  readonly repository: string;
  readonly commit: string;
  readonly chromium: string;
  readonly download: string;
} = bundle.source;

export const bundledDictionaries: readonly BundledDictionary[] =
  bundle.dictionaries;

/** The dictionary a language reads, if one comes with Zhiyin. */
export function dictionaryOf(code: string): BundledDictionary | undefined {
  return bundledDictionaries.find((dictionary) => dictionary.language === code);
}

const capitalised = (name: string) =>
  name.charAt(0).toLocaleUpperCase() + name.slice(1);

/** Every language offered, in English alphabetical order. */
export function offeredLanguages(): readonly SpellingLanguage[] {
  const inEnglish = new Intl.DisplayNames(["en"], { type: "language" });
  return bundledDictionaries
    .map(({ language: code }) => ({
      code,
      name: capitalised(
        new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code,
      ),
      englishName: inEnglish.of(code) ?? code,
    }))
    .sort((left, right) => left.englishName.localeCompare(right.englishName));
}

/**
 * Where a language with no dictionary of its own is checked as another, as
 * Chromium does: plain English as American, Portuguese as Brazilian, and
 * Norwegian as Bokmål.
 */
const aliases: Readonly<Record<string, string>> = {
  en: "en-US",
  pt: "pt-BR",
  no: "nb",
};

/** The offered language a Windows language tag is checked as, if any. */
function offeredFor(tag: string): string | undefined {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(tag);
  } catch {
    return undefined;
  }
  const { language, script, region } = locale;
  // Serbian in Latin letters has a dictionary of its own.
  if (language === "sr" && script === "Latn") return "sh";
  const candidates = [
    region ? `${language}-${region}` : undefined,
    language,
    aliases[language],
  ];
  return candidates.find(
    (candidate) => candidate !== undefined && dictionaryOf(candidate),
  );
}

/**
 * What is checked before the person chooses: their Windows languages that
 * have a dictionary, in their order, then American English unless an English
 * one is already there. A language with no dictionary is left out.
 */
export function defaultLanguages(systemLanguages: readonly string[]): string[] {
  const chosen: string[] = [];
  for (const tag of systemLanguages) {
    const code = offeredFor(tag);
    if (code && !chosen.includes(code)) chosen.push(code);
  }
  if (!chosen.some((code) => code.startsWith("en"))) chosen.push("en-US");
  return chosen;
}
