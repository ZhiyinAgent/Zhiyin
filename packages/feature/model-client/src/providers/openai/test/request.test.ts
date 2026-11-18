/**
 * What OpenAI is sent, and how its answer reads back. From OpenAI's API
 * documentation, checked 2026-10-09: one host, the Responses API (which its
 * current models need to call tools), nothing stored at OpenAI, and each
 * turn's output items, encrypted reasoning included, sent back with it.
 */

import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../../../model-client.js";
import {
  answeredWith,
  drain,
  messageItem,
  openAiClient,
  reasoningItem,
  recording,
  usage,
  type Sent,
} from "./support.js";
import {
  opened,
  startingTools,
  surfacing,
} from "../../../../test/opened-toolkit.js";

const hello = [{ role: "user" as const, content: "Hello" }];

const tool = {
  name: "read_note",
  description: "Reads the note.",
  inputSchema: { type: "object" },
};

const callItem = {
  id: "fc_1",
  type: "function_call",
  status: "completed",
  call_id: "call-1",
  name: "read_note",
  arguments: "{}",
};

const conversation: ModelMessage[] = [
  { role: "system", content: "Be brief." },
  { role: "user", content: "What does the note say?" },
  {
    role: "assistant",
    content: "",
    reasoning: "Read the note first.",
    toolCalls: [{ id: "call-1", name: "read_note", arguments: "{}" }],
    replay: {
      provider: "openai",
      format: "responses",
      data: { output: [reasoningItem, callItem] },
    },
  },
  {
    role: "tool",
    content: "Buy milk.",
    toolCallId: "call-1",
    name: "read_note",
  },
  {
    role: "assistant",
    content: "It says to buy milk.",
    reasoning: "The note answers it.",
    replay: {
      provider: "deepseek",
      format: "chat-completions",
      data: { reasoning_content: "The note answers it." },
    },
  },
  { role: "user", content: "Anything else?" },
];

describe("a request to OpenAI", () => {
  it("goes to OpenAI's Responses endpoint, with the key as a bearer token", async () => {
    const sent: Sent[] = [];

    await drain(openAiClient({ fetcher: recording(sent) }), {
      messages: hello,
    });

    expect(sent[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(sent[0]?.headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("streams, asks OpenAI to store nothing, names the model and the reply's limit, and asks for readable reasoning", async () => {
    const sent: Sent[] = [];

    await drain(openAiClient({ fetcher: recording(sent) }), {
      messages: hello,
      maximumOutputTokens: 32_000,
      session: "conversation-1",
    });

    expect(sent[0]?.body).toEqual({
      model: "gpt-6.1-sol",
      stream: true,
      store: false,
      max_output_tokens: 32_000,
      reasoning: { summary: "auto" },
      input: [{ role: "user", content: "Hello" }],
    });
  });

  it("sends each earlier turn OpenAI wrote as its output items, any other turn as its words and calls, and never names a tool to call", async () => {
    const sent: Sent[] = [];

    await drain(openAiClient({ fetcher: recording(sent) }), {
      messages: conversation,
      tools: [tool],
    });

    expect(sent[0]?.body["input"]).toEqual([
      { role: "developer", content: "Be brief." },
      { role: "user", content: "What does the note say?" },
      reasoningItem,
      callItem,
      { type: "function_call_output", call_id: "call-1", output: "Buy milk." },
      { role: "assistant", content: "It says to buy milk." },
      { role: "user", content: "Anything else?" },
    ]);
    expect(sent[0]?.body["tools"]).toEqual([
      {
        type: "function",
        name: "read_note",
        description: "Reads the note.",
        parameters: { type: "object" },
        strict: false,
      },
    ]);
    expect(sent[0]?.body).not.toHaveProperty("tool_choice");
    expect(sent[0]?.body).not.toHaveProperty("previous_response_id");
  });

  it("sends the effort the person chose, and `none` where they turned reasoning off", async () => {
    const sent: Sent[] = [];
    const luna = openAiClient({
      model: "gpt-6-luna",
      fetcher: recording(sent),
    });

    await drain(luna, { messages: hello, reasoning: { enabled: false } });
    await drain(luna, {
      messages: hello,
      reasoning: { enabled: true, effort: "xhigh" },
    });
    await drain(luna, { messages: hello, reasoning: { enabled: true } });

    expect(sent.map(({ body }) => body["reasoning"])).toEqual([
      { effort: "none" },
      { effort: "xhigh", summary: "auto" },
      { summary: "auto" },
    ]);
  });

  it("refuses to turn reasoning off on a model that always reasons, before sending anything", async () => {
    const sent: Sent[] = [];

    for (const model of ["gpt-6-astra", "gpt-6.1-sol"])
      await expect(
        drain(openAiClient({ model, fetcher: recording(sent) }), {
          messages: hello,
          reasoning: { enabled: false },
        }),
      ).rejects.toMatchObject({ code: "unsupportedReasoning" });
    expect(sent).toEqual([]);
  });

  it("refuses an effort the model does not offer, before sending anything", async () => {
    const sent: Sent[] = [];

    await expect(
      drain(openAiClient({ fetcher: recording(sent) }), {
        messages: hello,
        reasoning: { enabled: true, effort: "minimal" },
      }),
    ).rejects.toMatchObject({ code: "unsupportedReasoning" });
    expect(sent).toEqual([]);
  });
});

describe("OpenAI's answer", () => {
  it("streams its reasoning summary apart from its words, and reports what was read from and written to its cache", async () => {
    const events = await drain(openAiClient({ fetcher: recording([]) }), {
      messages: hello,
    });

    expect(
      events.filter((event) => event.kind !== "usage" && event.kind !== "done"),
    ).toEqual([
      { kind: "reasoningDelta", text: "Read the note first." },
      { kind: "textDelta", text: "Done." },
    ]);
    expect(events.find((event) => event.kind === "usage")).toMatchObject({
      usage: {
        requestId: "resp_1",
        model: "gpt-6.1-sol",
        inputTokens: 100_000,
        cacheReadTokens: 60_000,
        cacheWriteTokens: 10_000,
        outputTokens: 5_000,
        reasoningTokens: 2_000,
      },
    });
  });

  it("keeps the turn's output items as a record only OpenAI's Responses requests read back", async () => {
    const events = await drain(openAiClient({ fetcher: recording([]) }), {
      messages: hello,
    });

    expect(events.at(-1)).toMatchObject({
      kind: "done",
      replay: {
        provider: "openai",
        format: "responses",
        data: { output: [reasoningItem, messageItem] },
      },
    });
  });

  it("is priced from OpenAI's Standard list in US dollars, the whole request at long-context rates past 272K input", async () => {
    const cost = async (used: ReturnType<typeof usage>) => {
      const events = await drain(
        openAiClient({ fetcher: recording([], answeredWith(used)) }),
        { messages: hello },
      );
      const found = events.find((event) => event.kind === "usage");
      return found?.kind === "usage" ? found.usage.estimatedCost : undefined;
    };

    // GPT-6.1 Sol: 30K uncached, 60K from the cache, 10K written to it, 5K out.
    expect(await cost(usage(100_000, 60_000, 10_000, 5_000))).toEqual({
      amount: expect.closeTo(
        0.03 * 2 + 0.06 * 0.1 + 0.01 * 2.5 + 0.005 * 10,
        10,
      ),
      currency: "USD",
      priceList: "2026-10-09",
    });
    // 300K in: 100K uncached, 200K from the cache, 10K out, all at the long rates.
    expect(await cost(usage(300_000, 200_000, 0, 10_000))).toMatchObject({
      amount: expect.closeTo(0.1 * 4 + 0.2 * 0.2 + 0.01 * 15, 10),
    });
  });
});

describe("tools only some of which can be called", () => {
  it("keeps every tool and names those that can be called as allowed, so the request's start stays cached", async () => {
    const sent: Sent[] = [];
    const remember = { ...tool, name: "remember" };

    await drain(openAiClient({ fetcher: recording(sent) }), {
      messages: hello,
      tools: [tool, remember],
      callable: { tools: ["remember"], after: 0 },
    });

    expect(
      (sent[0]?.body["tools"] as { name: string }[]).map((one) => one.name),
    ).toEqual(["read_note", "remember"]);
    expect(sent[0]?.body["tool_choice"]).toEqual({
      type: "allowed_tools",
      mode: "auto",
      tools: [{ type: "function", name: "remember" }],
    });
  });
});

describe("a toolkit the model opened", () => {
  it("joins after the result that opened it as a client tool search and its output, leaving the tools and the input before it as they were", async () => {
    const sent: Sent[] = [];
    const client = openAiClient({
      model: "gpt-6-luna",
      fetcher: recording(sent),
    });

    await drain(client, { messages: opened, tools: startingTools });
    await drain(client, {
      messages: opened,
      tools: startingTools,
      loads: [surfacing],
    });

    const before = sent[0]?.body["input"] as unknown[];
    expect(sent[1]?.body["tools"]).toEqual(sent[0]?.body["tools"]);
    expect(sent[1]?.body["input"]).toEqual([
      ...before,
      {
        type: "tool_search_call",
        call_id: "zhiyin_load_1",
        execution: "client",
        status: "completed",
        arguments: {},
      },
      {
        type: "tool_search_output",
        call_id: "zhiyin_load_1",
        execution: "client",
        status: "completed",
        tools: [
          {
            type: "function",
            name: "set_material",
            description: "set_material.",
            parameters: { type: "object" },
            strict: false,
            defer_loading: true,
          },
        ],
      },
    ]);
  });

  it("is not sent to a model before GPT-5.4, which has no client tool search", async () => {
    const sent: Sent[] = [];
    const client = openAiClient({ model: "gpt-5.2", fetcher: recording(sent) });

    await drain(client, { messages: opened, tools: startingTools });
    await drain(client, {
      messages: opened,
      tools: startingTools,
      loads: [surfacing],
    });

    expect(sent[1]?.body).toEqual(sent[0]?.body);
  });
});
