/**
 * A Claude model can be added by a newer model list, with no new version of
 * the app (ADR 0027). What the list says of it is what the client does: how
 * its thinking turns off, and whether it takes tool changes mid-conversation.
 */

import { describe, expect, it } from "vitest";
import { ModelProviders } from "../../../model-providers.js";
import type { ListedModel, ModelLists } from "../../../model-list.js";
import { recording, type Sent } from "./support.js";

/** A newer list with one Claude model the shipped list does not have. */
function listAdding(model: Partial<ListedModel>): ModelLists {
  const added: ListedModel = {
    id: "claude-sonnet-6",
    name: "Claude Sonnet 6",
    contextWindow: 1_000_000,
    maximumOutputTokens: 64_000,
    acceptsImages: true,
    reasoning: {
      status: "available",
      required: false,
      defaultEnabled: true,
      efforts: ["low", "medium", "high"],
    },
    offered: { default: null },
    ...model,
  };
  return {
    lab: (provider) =>
      provider === "anthropic"
        ? { checked: "2026-11-12", models: [added] }
        : undefined,
  };
}

function clientWith(lists: ModelLists, sent: Sent[]) {
  return new ModelProviders({
    fixed: { provider: "anthropic", model: "claude-sonnet-6" },
    environment: () => "sk-ant-test",
    credentialEntry: () => ({
      getPassword: async () => undefined,
      setPassword: async () => undefined,
      deletePassword: async () => false,
    }),
    modelLists: lists,
    fetcher: recording(sent),
    // Anthropic's own model listing cannot be read, so the list stands.
    catalogFetch: async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }),
    retry: { wait: async () => undefined, random: () => 0 },
  });
}

async function drain(events: AsyncIterable<unknown>) {
  for await (const event of events) void event;
}

const thinkingOff = {
  messages: [{ role: "user" as const, content: "Hi" }],
  reasoning: { enabled: false },
};

describe("a Claude model a newer list adds", () => {
  it("is sent with its thinking turned off the way its entry says", async () => {
    const sent: Sent[] = [];
    const client = clientWith(
      listAdding({ reasoningOff: "betweenTools" }),
      sent,
    );

    await drain(client.send(thinkingOff));

    expect(sent.map(({ body }) => body["thinking"])).toEqual([
      { type: "between_tools" },
    ]);
  });

  it("is refused before anything is sent, saying the list does not say how, when its entry lets thinking be turned off but not how", async () => {
    const sent: Sent[] = [];
    const client = clientWith(listAdding({}), sent);

    await expect(drain(client.send(thinkingOff))).rejects.toMatchObject({
      code: "unsupportedReasoning",
      message:
        "Zhiyin's model list does not say how Claude Sonnet 6 turns its thinking off. Turn thinking on, or choose another model.",
    });
    expect(sent).toEqual([]);
  });

  it("loads opened tools natively and withdraws tools mid-conversation where its entry says it takes tool changes, and not otherwise", async () => {
    const sent: Sent[] = [];
    const tool = (name: string) => ({
      name,
      description: `${name}.`,
      inputSchema: { type: "object" },
    });
    const request = {
      messages: [{ role: "user" as const, content: "Hi" }],
      tools: [tool("read_note"), tool("remember")],
      callable: { tools: ["remember"], after: 0 },
    };
    const taking = clientWith(
      listAdding({ withdrawsTools: true, loadsTools: true }),
      sent,
    );
    const notTaking = clientWith(listAdding({}), sent);

    expect(await taking.settings()).toMatchObject({ loadsTools: true });
    expect(await notTaking.settings()).not.toHaveProperty("loadsTools");

    await drain(taking.send(request));
    await drain(notTaking.send(request));

    expect(sent.map(({ headers }) => headers["anthropic-beta"])).toEqual([
      "inline-tools-2026-09-15",
      undefined,
    ]);
  });
});
