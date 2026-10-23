import { describe, expect, it } from "vitest";
import {
  Spelling,
  type BundledDictionary,
  type SpellcheckEngine,
} from "../src/index.js";

/** Records what the spellchecker was told, and answers as told to. */
function engine() {
  const said: string[] = [];
  let listener: (
    code: string,
    outcome: "ready" | "unavailable",
  ) => void = () => {};
  const spellchecker: SpellcheckEngine = {
    setEnabled: (enabled) => said.push(enabled ? "on" : "off"),
    setLanguages: (codes) => said.push(`languages ${codes.join(",")}`),
    onLanguage: (heard) => {
      listener = heard;
    },
  };
  return {
    spellchecker,
    said,
    answer: (code: string, outcome: "ready" | "unavailable") =>
      listener(code, outcome),
  };
}

function shelf(said: string[]) {
  return {
    place: async (dictionary: BundledDictionary) => {
      said.push(`placed ${dictionary.file}`);
      return "placed" as const;
    },
  };
}

const statuses = (spelling: Spelling) =>
  spelling
    .state()
    .languages.map((language) => `${language.code} ${language.status}`);

describe("applying the person's choice", () => {
  it("places each dictionary before the spellchecker is given the languages", async () => {
    const { spellchecker, said, answer } = engine();
    const spelling = new Spelling({
      engine: spellchecker,
      shelf: shelf(said),
      systemLanguages: ["fr-FR", "zh-Hans-CN"],
    });

    await spelling.apply(undefined);

    expect(said).toEqual([
      "placed fr-FR-3-0.bdic",
      "placed en-US-10-1.bdic",
      "languages fr,en-US",
      "on",
    ]);
    expect(spelling.state().enabled).toBe(true);
    expect(statuses(spelling)).toEqual(["fr loading", "en-US loading"]);

    answer("fr", "ready");
    answer("en-US", "ready");
    expect(statuses(spelling)).toEqual(["fr ready", "en-US ready"]);
  });

  it("says when a language could not be loaded, and keeps checking the others", async () => {
    const { spellchecker, answer } = engine();
    const spelling = new Spelling({
      engine: spellchecker,
      shelf: shelf([]),
      systemLanguages: [],
    });
    const told: string[][] = [];
    spelling.onChanged(() => told.push(statuses(spelling)));

    await spelling.apply({ enabled: true, languages: ["de", "es"] });
    answer("de", "unavailable");
    answer("es", "ready");

    expect(statuses(spelling)).toEqual(["de unavailable", "es ready"]);
    expect(told.at(-1)).toEqual(["de unavailable", "es ready"]);
    expect(spelling.state().enabled).toBe(true);
  });

  it("turned off, checks nothing and keeps the languages chosen", async () => {
    const { spellchecker, said, answer } = engine();
    const spelling = new Spelling({
      engine: spellchecker,
      shelf: shelf(said),
      systemLanguages: [],
    });
    await spelling.apply({ enabled: true, languages: ["it"] });
    answer("it", "ready");
    said.length = 0;

    await spelling.apply({ enabled: false, languages: ["it"] });

    expect(said).toEqual(["off"]);
    expect(spelling.state()).toMatchObject({
      enabled: false,
      languages: [{ code: "it", status: "ready" }],
    });
  });

  it("still checks a language whose dictionary could not be placed, leaving the spellchecker to fetch it", async () => {
    const { spellchecker, said } = engine();
    const spelling = new Spelling({
      engine: spellchecker,
      shelf: {
        place: async () => {
          throw new Error("The disk is full.");
        },
      },
      systemLanguages: [],
    });

    await spelling.apply({ enabled: true, languages: ["sv"] });

    expect(said).toEqual(["languages sv", "on"]);
    expect(statuses(spelling)).toEqual(["sv loading"]);
  });

  it("checks no language it has no dictionary for", async () => {
    const { spellchecker, said } = engine();
    const spelling = new Spelling({
      engine: spellchecker,
      shelf: shelf(said),
      systemLanguages: [],
    });

    await spelling.apply({ enabled: true, languages: ["zh-CN", "nl"] });

    expect(said).toEqual(["placed nl-NL-3-0.bdic", "languages nl", "on"]);
  });
});
