import { describe, expect, it } from "vitest";
import {
  bundledDictionaries,
  defaultLanguages,
  offeredLanguages,
} from "../src/index.js";

describe("the languages offered", () => {
  it("offers each dictionary once, named in its language and in English", () => {
    const offered = offeredLanguages();
    const files = offered.map(
      (language) =>
        bundledDictionaries.find(
          (dictionary) => dictionary.language === language.code,
        )?.file,
    );

    expect(offered).toHaveLength(bundledDictionaries.length);
    expect(new Set(files).size).toBe(files.length);
    expect(files).not.toContain(undefined);
    expect(offered).toContainEqual({
      code: "fr",
      name: "Français",
      englishName: "French",
    });
    expect(offered).toContainEqual({
      code: "en-GB",
      name: "British English",
      englishName: "British English",
    });
    expect(offered.map((language) => language.code)).not.toContain("zh-CN");
  });
});

describe("the languages checked before the person chooses", () => {
  it("checks the Windows languages that have a dictionary, then American English", () => {
    expect(defaultLanguages(["fr-FR", "zh-Hans-CN"])).toEqual(["fr", "en-US"]);
    expect(defaultLanguages(["en-GB", "pt-PT"])).toEqual(["en-GB", "pt-PT"]);
    expect(defaultLanguages(["es-MX", "sr-Latn-RS", "nb-NO"])).toEqual([
      "es",
      "sh",
      "nb",
      "en-US",
    ]);
    expect(defaultLanguages(["de-CH", "de-DE"])).toEqual(["de", "en-US"]);
    expect(defaultLanguages(["ja-JP"])).toEqual(["en-US"]);
    expect(defaultLanguages([])).toEqual(["en-US"]);
  });
});
