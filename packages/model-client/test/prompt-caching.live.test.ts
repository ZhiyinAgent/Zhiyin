/**
 * Checks against the real provider that a request repeating the start of the
 * one before it is billed from the cache — including after a round of 12
 * parallel tool calls, which passes Anthropic's 20-block lookback from the
 * newest mark and so needs the mark left at the end of the previous request.
 *
 * Skips unless `OPENROUTER_API_KEY` is set, like the feature's other live
 * checks. Not yet run against the live provider.
 */

import { describe, expect, it } from "vitest";
import {
  fetchOpenRouterCatalog,
  OpenRouterModelClient,
  type ModelMessage,
  type ModelRequest,
  type ModelUsage,
} from "../src/index.js";

const key = process.env["OPENROUTER_API_KEY"];

/** Well past every provider's minimum for caching (4,096 tokens at most). */
const longInstructions = Array.from(
  { length: 900 },
  (_, index) =>
    `Rule ${index + 1}: keep each answer short, plain, and about the notes only.`,
).join("\n");

const tools = [
  {
    name: "read_note",
    description: "Read one note by number.",
    inputSchema: {
      type: "object",
      properties: { note: { type: "number" } },
      required: ["note"],
    },
  },
];

function parallelRound(from: number): ModelMessage[] {
  const ids = Array.from({ length: 12 }, (_, index) => `call_${from + index}`);
  return [
    {
      role: "assistant",
      content: "",
      toolCalls: ids.map((id, index) => ({
        id,
        name: "read_note",
        arguments: JSON.stringify({ note: from + index }),
      })),
    },
    ...ids.map((id, index): ModelMessage => ({
      role: "tool",
      toolCallId: id,
      name: "read_note",
      content: `Note ${from + index} says the launch moved to December ${index + 1}.`,
    })),
  ];
}

async function usageOf(
  client: OpenRouterModelClient,
  request: ModelRequest,
): Promise<ModelUsage | undefined> {
  let usage: ModelUsage | undefined;
  for await (const event of client.send(request))
    if (event.kind === "usage") usage = event.usage;
  return usage;
}

/** Three requests, each starting with the whole of the one before it. */
async function conversation(model: string) {
  const client = new OpenRouterModelClient({ apiKey: async () => key, model });
  const session = `live-cache-${Date.now()}`;
  const first: ModelMessage[] = [
    { role: "system", content: longInstructions },
    { role: "user", content: "Read notes 1 to 12." },
  ];
  const second = [
    ...first,
    ...parallelRound(1),
    { role: "user" as const, content: "Now notes 13 to 24." },
  ];
  const third = [
    ...second,
    ...parallelRound(13),
    { role: "user" as const, content: "When is the launch?" },
  ];
  const usages: (ModelUsage | undefined)[] = [];
  let previous: number | undefined;
  for (const messages of [first, second, third]) {
    const cacheAfter = [
      ...new Set([0, ...(previous ? [previous - 1] : []), messages.length - 1]),
    ].sort((left, right) => left - right);
    previous = messages.length;
    usages.push(
      await usageOf(client, {
        messages,
        tools,
        maximumOutputTokens: 16,
        session,
        cacheAfter,
      }),
    );
  }
  return usages;
}

describe.skipIf(!key)("live prompt caching", () => {
  it("reads the repeated start from the cache on a Claude model, after 12 parallel calls too", async () => {
    const catalog = await fetchOpenRouterCatalog({ apiKey: async () => key });
    if (catalog.status !== "ready") throw new Error("No catalogue.");
    const claude = catalog.models.find((model) =>
      model.id.startsWith("anthropic/claude-sonnet"),
    );
    if (!claude) throw new Error("No Claude Sonnet model is listed.");

    const [, second, third] = await conversation(claude.id);

    expect(second?.cacheReadTokens).toBeGreaterThan(0);
    expect(third?.cacheReadTokens).toBeGreaterThan(0);
  }, 120_000);

  it("reads the repeated start from the cache on the default model, with no marks sent", async () => {
    const [, second, third] = await conversation("z-ai/glm-5.3-flash");

    expect(second?.cacheReadTokens).toBeGreaterThan(0);
    expect(third?.cacheReadTokens).toBeGreaterThan(0);
  }, 120_000);
});
