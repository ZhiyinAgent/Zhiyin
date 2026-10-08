import type { SpellingLanguage, SpellingState } from "@zhiyin/contract";

/** A few of the languages the app checks, named as the core names them. */
export const demoSpellingLanguages: readonly SpellingLanguage[] = [
  { code: "en-US", name: "American English", englishName: "American English" },
  { code: "en-GB", name: "British English", englishName: "British English" },
  { code: "nl", name: "Nederlands", englishName: "Dutch" },
  { code: "fr", name: "Français", englishName: "French" },
  { code: "de", name: "Deutsch", englishName: "German" },
  { code: "it", name: "Italiano", englishName: "Italian" },
  {
    code: "pt-BR",
    name: "Português (Brasil)",
    englishName: "Brazilian Portuguese",
  },
  { code: "es", name: "Español", englishName: "Spanish" },
];

export const demoSpelling: SpellingState = {
  enabled: true,
  languages: [
    { code: "en-US", status: "ready" },
    { code: "fr", status: "ready" },
  ],
  offered: demoSpellingLanguages,
};
