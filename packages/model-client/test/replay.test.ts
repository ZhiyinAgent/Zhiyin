/**
 * A replay record is what one provider needs back to continue a model's turn;
 * it may be signed or encrypted for that provider alone (ADR 0015). A turn
 * written by another provider, after the person switched, goes back with its
 * words and reasoning only.
 */

import { describe, expect, it } from "vitest";
import type { ModelReplay } from "@zhiyin/contract";
import { ProviderModelClient } from "../src/client.js";
import type { ModelMessage } from "../src/index.js";
import type { SendInput } from "../src/provider.js";
import { testProvider } from "./test-provider.js";

const providerSeeing = (id: string, seen: SendInput[]) =>
  testProvider(seen, { id });

const ownReplay: ModelReplay = {
  provider: "this-provider",
  format: "chat-completions",
  data: { signature: "mine" },
};
const otherReplay: ModelReplay = {
  provider: "earlier-provider",
  format: "anthropic-messages",
  data: { signature: "theirs" },
};

describe("replay records sent back to a provider", () => {
  it("gives a provider back only the records it produced, and keeps every turn's reasoning", async () => {
    const seen: SendInput[] = [];
    const client = new ProviderModelClient(
      providerSeeing("this-provider", seen),
      { apiKey: async () => "key", model: "model-1" },
    );
    const messages: ModelMessage[] = [
      { role: "user", content: "First" },
      {
        role: "assistant",
        content: "Written earlier.",
        reasoning: "Thought earlier.",
        replay: otherReplay,
      },
      { role: "user", content: "Second" },
      {
        role: "assistant",
        content: "Written here.",
        reasoning: "Thought here.",
        replay: ownReplay,
      },
      { role: "user", content: "Third" },
    ];

    for await (const event of client.send({ messages })) void event;

    expect(seen[0]?.request.messages).toEqual([
      { role: "user", content: "First" },
      {
        role: "assistant",
        content: "Written earlier.",
        reasoning: "Thought earlier.",
      },
      { role: "user", content: "Second" },
      {
        role: "assistant",
        content: "Written here.",
        reasoning: "Thought here.",
        replay: ownReplay,
      },
      { role: "user", content: "Third" },
    ]);
  });
});
