/**
 * A request may name the only tools the model can call from one message on,
 * as the look back over a turn does (ADR 0026). A provider that can withdraw
 * the others without changing what it caches keeps them in the request:
 * Anthropic with a `tool_removal` in a mid-conversation system message, from
 * its mid-conversation system messages guide (checked 2026-11-01). Any other
 * is sent the request's tools as they are, so what it caches still matches,
 * and the caller refuses a call to any tool outside `callable` (ADR 0016).
 */

import { describe, expect, it } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import type { ModelMessage, ModelTool } from "../src/index.js";
import type { SendInput } from "../src/provider.js";
import {
  labDialect,
  recording,
  sendOnce,
  sentBody,
  type Sent,
} from "./anthropic-messages-support.js";
import { drain } from "./lab-wire.js";
import { testProvider } from "./test-provider.js";

const tool = (name: string): ModelTool => ({
  name,
  description: `${name}.`,
  inputSchema: { type: "object" },
});
const tools = [tool("run_script"), tool("remember"), tool("recall")];

/** A finished turn, then a notice the model answers with memory alone. */
const lookingBack: ModelMessage[] = [
  { role: "system", content: "You are Zhiyin." },
  { role: "user", content: "Make the stand." },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "toolu_1", name: "run_script", arguments: "{}" }],
  },
  {
    role: "tool",
    toolCallId: "toolu_1",
    name: "run_script",
    content: "Built.",
  },
  { role: "assistant", content: "Done." },
  { role: "user", content: "Is anything worth keeping?" },
];
const memoryOnly = { tools: ["remember", "recall"], after: 5 };

const withdrawal = {
  role: "system",
  content: [
    {
      type: "tool_removal",
      tool: { type: "tool_reference", name: "run_script" },
    },
  ],
};

describe("a provider that cannot withdraw a tool", () => {
  it("is sent every tool, as the requests before it were, and not which can be called", async () => {
    const seen: SendInput[] = [];
    const client = new ProviderModelClient(testProvider(seen), {
      apiKey: async () => "key",
      model: "model-1",
    });

    await drain(client, {
      messages: lookingBack,
      tools,
      callable: memoryOnly,
    });

    expect(seen[0]?.request.tools).toEqual(tools);
    expect(seen[0]?.request.callable).toBeUndefined();
  });
});

describe("a provider that withdraws tools for the chosen model", () => {
  it("is sent every tool and which can be called", async () => {
    const seen: SendInput[] = [];
    const client = new ProviderModelClient(
      testProvider(seen, { withdrawsTools: (model) => model === "model-1" }),
      { apiKey: async () => "key", model: "model-1" },
    );

    await drain(client, {
      messages: lookingBack,
      tools,
      callable: memoryOnly,
    });

    expect(seen[0]?.request.tools).toEqual(tools);
    expect(seen[0]?.request.callable).toEqual(memoryOnly);
  });
});

describe("withdrawing tools over Anthropic Messages", () => {
  const withdrawing = labDialect([], {
    toolChanges: { "anthropic-beta": "inline-tools-2026-09-15" },
  });

  it("keeps every tool, and withdraws the others in a system message right after the message they apply from", async () => {
    const body = await sentBody(
      { messages: lookingBack, tools, callable: memoryOnly },
      withdrawing,
    );

    expect(
      (body["tools"] as { name: string }[]).map((one) => one.name),
    ).toEqual(["run_script", "remember", "recall"]);
    const messages = body["messages"] as unknown[];
    expect(messages.at(-2)).toEqual({
      role: "user",
      content: [{ type: "text", text: "Is anything worth keeping?" }],
    });
    expect(messages.at(-1)).toEqual(withdrawal);
  });

  it("keeps the withdrawal where it was as the look back goes on, so what came before stays cached", async () => {
    const body = await sentBody(
      {
        messages: [
          ...lookingBack,
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "toolu_2", name: "recall", arguments: "{}" }],
          },
          {
            role: "tool",
            toolCallId: "toolu_2",
            name: "recall",
            content: "Nothing kept.",
          },
        ],
        tools,
        callable: memoryOnly,
      },
      withdrawing,
    );

    const messages = body["messages"] as { role: string }[];
    expect(messages.map((one) => one.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "system",
      "assistant",
      "user",
    ]);
    expect(messages[5]).toEqual(withdrawal);
  });

  it("names the dialect's beta when it withdraws a tool, and only then", async () => {
    const sent: Sent[] = [];
    const fetcher = recording(sent);

    await sendOnce(
      { messages: lookingBack, tools, callable: memoryOnly },
      { fetcher, dialect: withdrawing },
    );
    await sendOnce(
      { messages: lookingBack, tools },
      { fetcher, dialect: withdrawing },
    );

    expect(sent[0]?.headers["anthropic-beta"]).toBe("inline-tools-2026-09-15");
    expect(sent[1]?.headers["anthropic-beta"]).toBeUndefined();
  });

  it("sends only the tools that can be called where Anthropic would not take a system message", async () => {
    // After the model's own turn, not after one of the person's.
    const body = await sentBody(
      { messages: lookingBack, tools, callable: { ...memoryOnly, after: 4 } },
      withdrawing,
    );

    expect(
      (body["tools"] as { name: string }[]).map((one) => one.name),
    ).toEqual(["remember", "recall"]);
    expect(
      (body["messages"] as { role: string }[]).some(
        (one) => one.role === "system",
      ),
    ).toBe(false);
  });

  it("sends only the tools that can be called over a dialect that cannot withdraw one", async () => {
    const body = await sentBody({
      messages: lookingBack,
      tools,
      callable: memoryOnly,
    });

    expect(
      (body["tools"] as { name: string }[]).map((one) => one.name),
    ).toEqual(["remember", "recall"]);
  });
});
