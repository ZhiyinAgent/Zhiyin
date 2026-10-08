import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzySegments } from "./fuzzy.js";

/** Ranks candidates the way the list does, best first. */
function rank(query: string, candidates: readonly string[]) {
  return candidates
    .map((text) => ({ text, match: fuzzyMatch(query, text) }))
    .filter(
      (row): row is { text: string; match: NonNullable<typeof row.match> } =>
        row.match !== null,
    )
    .sort((a, b) => b.match.score - a.match.score)
    .map((row) => row.text);
}

const models = [
  "Anthropic: Claude Sonnet 5  anthropic/claude-sonnet-5",
  "Anthropic: Claude Haiku 4.5  anthropic/claude-haiku-4.5",
  "MoonshotAI: Kimi K2.5  moonshotai/kimi-k2.5",
  "Z.ai: GLM 5.3 Flash  z-ai/glm-5.3-flash",
  "OpenAI: GPT-5.4  openai/gpt-5.4",
];

describe("model name matching", () => {
  it("finds a model from an abbreviation that is not a substring", () => {
    expect(rank("son5", models)[0]).toContain("anthropic/claude-sonnet-5");
  });

  it("finds a model when the words are run together", () => {
    expect(rank("glmflash", models)[0]).toContain("z-ai/glm-5.3-flash");
  });

  it("matches on the slug as well as the display name", () => {
    expect(rank("kimik2", models)[0]).toContain("moonshotai/kimi-k2.5");
  });

  it("prefers a match that starts words over one scattered through the text", () => {
    expect(rank("gpt", models)[0]).toContain("openai/gpt-5.4");
  });

  it("rejects a query whose characters are not all present in order", () => {
    expect(fuzzyMatch("zzz", "Anthropic: Claude Sonnet 5")).toBeNull();
  });

  it("treats an empty query as matching everything, unranked", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, hits: [] });
  });

  it("marks the matched characters so the list can emphasise them", () => {
    const match = fuzzyMatch("son", "claude-sonnet-5");
    expect(fuzzySegments("claude-sonnet-5", match?.hits ?? [])).toEqual([
      { text: "claude-", matched: false },
      { text: "son", matched: true },
      { text: "net-5", matched: false },
    ]);
  });
});
