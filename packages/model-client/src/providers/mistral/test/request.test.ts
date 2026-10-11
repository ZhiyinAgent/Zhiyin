/**
 * What Mistral is sent. From Mistral's API reference and its reasoning,
 * prompt caching and function calling guides, checked 2026-10-09: one host,
 * a request body that accepts only the fields it lists, `reasoning_effort`
 * `high` for a full thinking trace and `none` for none, and every earlier
 * turn sent back whole, its thinking included, as a list of chunks.
 */

import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../../../model-client.js";
import { drain, mistralClient, recording, type Sent } from "./support.js";

const tool = {
  name: "read_note",
  description: "Reads the note.",
  inputSchema: { type: "object" },
};

const hello = [{ role: "user" as const, content: "Hello" }];

describe("a request to Mistral", () => {
  it("goes to Mistral's one host, with the key as a bearer token", async () => {
    const sent: Sent[] = [];

    await drain(mistralClient({ fetcher: recording(sent) }), {
      messages: hello,
    });

    expect(sent[0]?.url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(sent[0]?.headers["Authorization"]).toBe("Bearer mistral-test-key");
  });

  it("streams, names the model and the reply's limit, and keys its cache to the conversation", async () => {
    const sent: Sent[] = [];

    await drain(mistralClient({ fetcher: recording(sent) }), {
      messages: hello,
      maximumOutputTokens: 32_000,
      session: "conversation-1",
    });

    // Nothing else: the request body accepts only the fields Mistral lists,
    // and `stream_options` is not one of them.
    expect(sent[0]?.body).toEqual({
      model: "mistral-large-4",
      stream: true,
      max_tokens: 32_000,
      prompt_cache_key: "conversation-1",
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("sends every earlier turn back whole, its reasoning as a thinking chunk before its words", async () => {
    const sent: Sent[] = [];
    const conversation: ModelMessage[] = [
      { role: "user", content: "What does the note say?" },
      {
        role: "assistant",
        content: "",
        reasoning: "Read the note first.",
        toolCalls: [{ id: "D681PevKs", name: "read_note", arguments: "{}" }],
      },
      {
        role: "tool",
        content: "Buy milk.",
        toolCallId: "D681PevKs",
        name: "read_note",
      },
      {
        role: "assistant",
        content: "It says to buy milk.",
        reasoning: "The note answers it.",
      },
      { role: "assistant", content: "Anything else?" },
      { role: "user", content: "No." },
    ];

    await drain(mistralClient({ fetcher: recording(sent) }), {
      messages: conversation,
      tools: [tool],
    });

    expect(sent[0]?.body["messages"]).toEqual([
      { role: "user", content: "What does the note say?" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: [{ type: "text", text: "Read the note first." }],
          },
        ],
        tool_calls: [
          {
            id: "D681PevKs",
            type: "function",
            function: { name: "read_note", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        content: "Buy milk.",
        tool_call_id: "D681PevKs",
        name: "read_note",
      },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: [{ type: "text", text: "The note answers it." }],
          },
          { type: "text", text: "It says to buy milk." },
        ],
      },
      { role: "assistant", content: "Anything else?" },
      { role: "user", content: "No." },
    ]);
    expect(sent[0]?.body["tools"]).toEqual([
      {
        type: "function",
        function: {
          name: "read_note",
          description: "Reads the note.",
          parameters: { type: "object" },
        },
      },
    ]);
    expect(sent[0]?.body).not.toHaveProperty("tool_choice");
  });

  it("asks for a full thinking trace when reasoning is on, and for none when it is off", async () => {
    const sent: Sent[] = [];
    const client = mistralClient({ fetcher: recording(sent) });

    await drain(client, { messages: hello, reasoning: { enabled: false } });
    await drain(client, {
      messages: hello,
      reasoning: { enabled: true, effort: "high" },
    });
    await drain(client, { messages: hello, reasoning: { enabled: true } });
    await drain(client, { messages: hello });

    expect(sent.map(({ body }) => body["reasoning_effort"])).toEqual([
      "none",
      "high",
      "high",
      undefined,
    ]);
  });

  it("refuses an effort Mistral does not document before sending anything", async () => {
    const sent: Sent[] = [];

    for (const effort of ["low", "medium", "xhigh"] as const)
      await expect(
        drain(mistralClient({ fetcher: recording(sent) }), {
          messages: hello,
          reasoning: { enabled: true, effort },
        }),
      ).rejects.toMatchObject({ code: "unsupportedReasoning" });
    expect(sent).toEqual([]);
  });

  it("sends a picture as a data URL in an image chunk of the user's message", async () => {
    const sent: Sent[] = [];

    await drain(
      mistralClient({ model: "mistral-medium-3-5", fetcher: recording(sent) }),
      {
        messages: [
          {
            role: "user",
            content: [
              { kind: "text", text: "What is this?" },
              { kind: "image", mediaType: "image/png", data: "AAAA" },
            ],
          },
        ],
        cacheAfter: [0],
      },
    );

    // Unmarked: Mistral caches a repeated start on its own, and its content
    // chunks accept no other fields.
    expect(sent[0]?.body["messages"]).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AAAA" },
          },
        ],
      },
    ]);
  });
});
