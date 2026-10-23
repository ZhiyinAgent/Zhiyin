/**
 * A request with a reasoning setting first looks up what the model accepts.
 * When that lookup fails for a moment, the request is sent again as any
 * passing failure is, and the lookup with it.
 */

import { describe, expect, it } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import { deepSeek } from "./shipped-providers.js";
import {
  drain,
  recording,
  type Sent,
} from "../src/providers/deepseek/test/support.js";

describe("a reasoning lookup that fails for a moment", () => {
  it("is tried again with the request, which then goes", async () => {
    let lookups = 0;
    const sent: Sent[] = [];
    const client = new ProviderModelClient(deepSeek, {
      apiKey: async () => "sk-test",
      model: "deepseek-v4-pro",
      region: "international",
      modelInfo: async (model) => {
        lookups += 1;
        if (lookups === 1) throw new Error("The connection was reset.");
        return deepSeek.describe(model, { region: "international" });
      },
      fetcher: recording(sent),
      retry: { wait: async () => {}, random: () => 0 },
    });

    const events = await drain(client, {
      messages: [{ role: "user", content: "Hello" }],
      reasoning: { enabled: true, effort: "high" },
    });

    expect(lookups).toBe(2);
    expect(sent).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ kind: "done" });
  });
});
