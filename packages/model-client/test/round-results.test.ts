/**
 * The results of one round of calls, as every format sends them: directly
 * after the calls, before anything else. A picture a call made is told to the
 * model as a user message after that call's result, so a round of two calls,
 * the first of which made a picture, is kept with the picture between the two
 * results. Chat Completions refuses that order ("An assistant message with
 * 'tool_calls' must be followed by tool messages responding to each
 * 'tool_call_id'", OpenAI's and DeepSeek's wording); Anthropic wants every
 * tool result ahead of anything else in the turn that follows the calls
 * (tool-use guide, checked 2026-10-14).
 */

import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../src/model-client.js";
import type { Sent } from "./lab-wire.js";
import {
  anthropicClient,
  drain as drainAnthropic,
  recording as anthropicRecording,
} from "../src/providers/anthropic/test/support.js";
import {
  deepSeekClient,
  drain as drainDeepSeek,
  recording as deepSeekRecording,
} from "../src/providers/deepseek/test/support.js";
import {
  drain as drainOpenAi,
  openAiClient,
  recording as openAiRecording,
} from "../src/providers/openai/test/support.js";

/** A round of two calls whose first made a picture, kept as it happened. */
const round: ModelMessage[] = [
  { role: "user", content: "Make the stand and check the file." },
  {
    role: "assistant",
    content: "Rendering, then checking the file.",
    toolCalls: [
      { id: "call-render", name: "render", arguments: "{}" },
      { id: "call-check", name: "check", arguments: "{}" },
    ],
  },
  {
    role: "tool",
    toolCallId: "call-render",
    name: "render",
    content: "Rendered.",
  },
  {
    role: "user",
    content: [
      { kind: "text", text: "The picture from render:" },
      { kind: "image", mediaType: "image/png", data: "cGljdHVyZQ==" },
    ],
  },
  {
    role: "tool",
    toolCallId: "call-check",
    name: "check",
    content: "Closed mesh.",
  },
];

describe("the results of a round of calls", () => {
  it("follow the calls directly over Chat Completions, the picture after both", async () => {
    const sent: Sent[] = [];
    await drainDeepSeek(
      deepSeekClient({
        model: "deepseek-flash",
        fetcher: deepSeekRecording(sent),
      }),
      { messages: round },
    );

    const messages = sent[0]?.body["messages"] as Record<string, unknown>[];
    expect(
      messages.map((message) => [message["role"], message["tool_call_id"]]),
    ).toEqual([
      ["user", undefined],
      ["assistant", undefined],
      ["tool", "call-render"],
      ["tool", "call-check"],
      ["user", undefined],
    ]);
    expect(JSON.stringify(messages[4])).toContain("The picture from render:");
  });

  it("follow the calls directly over Responses, the picture after both", async () => {
    const sent: Sent[] = [];
    await drainOpenAi(openAiClient({ fetcher: openAiRecording(sent) }), {
      messages: round,
    });

    const input = sent[0]?.body["input"] as Record<string, unknown>[];
    expect(
      input.map((item) => [item["type"] ?? item["role"], item["call_id"]]),
    ).toEqual([
      ["user", undefined],
      ["assistant", undefined],
      ["function_call", "call-render"],
      ["function_call", "call-check"],
      ["function_call_output", "call-render"],
      ["function_call_output", "call-check"],
      ["user", undefined],
    ]);
  });

  it("lead the turn after the calls over Anthropic Messages, the picture after both", async () => {
    const sent: Sent[] = [];
    await drainAnthropic(
      anthropicClient({ fetcher: anthropicRecording(sent) }),
      {
        messages: round,
      },
    );

    const messages = sent[0]?.body["messages"] as {
      role: string;
      content: Record<string, unknown>[];
    }[];
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(messages[2]?.content.map((block) => block["type"])).toEqual([
      "tool_result",
      "tool_result",
      "text",
      "image",
    ]);
  });

  it("keep a cache mark on the message it was asked for, wherever that message goes", async () => {
    const sent: Sent[] = [];
    // The last message, the second result, is where the cache may end.
    await drainAnthropic(
      anthropicClient({ fetcher: anthropicRecording(sent) }),
      {
        messages: round,
        cacheAfter: [4],
      },
    );

    const messages = sent[0]?.body["messages"] as {
      content: Record<string, unknown>[];
    }[];
    const marked = messages
      .flatMap((message) => message.content)
      .filter((block) => block["cache_control"]);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "call-check",
    });
  });

  it("leave a round with nothing between its results as it was kept", async () => {
    const plain = round.filter(
      (message) =>
        message.role !== "user" || typeof message.content === "string",
    );
    const sent: Sent[] = [];
    await drainDeepSeek(
      deepSeekClient({
        model: "deepseek-flash",
        fetcher: deepSeekRecording(sent),
      }),
      { messages: [...plain, { role: "user", content: "And now?" }] },
    );

    const messages = sent[0]?.body["messages"] as Record<string, unknown>[];
    expect(messages.map((message) => message["role"])).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "user",
    ]);
  });
});
