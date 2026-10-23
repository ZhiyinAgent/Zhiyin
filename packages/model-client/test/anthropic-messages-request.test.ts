/**
 * The conversation as Anthropic Messages carries it, from Anthropic's Messages
 * API reference, tool use and prompt caching guides (checked 2026-10-09): the
 * system prompt as top-level text blocks, the turns as content blocks, tool
 * results first in the user turn that answers them, and cache marks on at
 * most four blocks.
 */

import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../src/model-client.js";
import {
  recording,
  sendOnce,
  sentBody,
  type Sent,
} from "./anthropic-messages-support.js";

const readNote: ModelMessage[] = [
  { role: "system", content: "You are Zhiyin." },
  { role: "system", content: "Available skills: none." },
  { role: "user", content: "Read the note." },
  {
    role: "assistant",
    content: "Reading it.",
    toolCalls: [
      { id: "toolu_1", name: "read_note", arguments: '{"name":"todo"}' },
    ],
  },
  {
    role: "tool",
    toolCallId: "toolu_1",
    name: "read_note",
    content: "Buy milk.",
  },
  { role: "user", content: "Thanks." },
];

describe("a request over Anthropic Messages", () => {
  it("goes to the endpoint with the dialect's headers and settings, streamed", async () => {
    const sent: Sent[] = [];

    await sendOnce(
      { messages: [{ role: "user", content: "Hello" }] },
      { fetcher: recording(sent) },
    );

    expect(sent[0]?.url).toBe("https://lab.test/v1/messages");
    expect(sent[0]?.headers).toEqual({ "x-test-key": "lab-key" });
    expect(sent[0]?.body).toEqual({
      model: "lab-model",
      max_tokens: 1000,
      stream: true,
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    });
  });

  it("puts the system prompt in its own field and the conversation after it as user and assistant turns", async () => {
    const body = await sentBody({ messages: readNote });

    expect(body["system"]).toEqual([
      { type: "text", text: "You are Zhiyin." },
      { type: "text", text: "Available skills: none." },
    ]);
    expect(body["messages"]).toEqual([
      { role: "user", content: [{ type: "text", text: "Read the note." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Reading it." },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_note",
            input: { name: "todo" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: "Buy milk.",
          },
          { type: "text", text: "Thanks." },
        ],
      },
    ]);
  });

  it("answers parallel calls in one user turn, results first, before a picture a tool produced", async () => {
    const body = await sentBody({
      messages: [
        { role: "user", content: "Look at both." },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "toolu_a", name: "screenshot", arguments: "{}" },
            { id: "toolu_b", name: "read_note", arguments: "{}" },
          ],
        },
        {
          role: "tool",
          toolCallId: "toolu_a",
          name: "screenshot",
          content: "Screenshot attached below.",
        },
        {
          role: "user",
          content: [
            { kind: "text", text: "The screenshot:" },
            { kind: "image", mediaType: "image/png", data: "AAAA" },
          ],
        },
        {
          role: "tool",
          toolCallId: "toolu_b",
          name: "read_note",
          content: "Buy milk.",
        },
      ],
    });

    expect(body["messages"]).toEqual([
      { role: "user", content: [{ type: "text", text: "Look at both." }] },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_a", name: "screenshot", input: {} },
          { type: "tool_use", id: "toolu_b", name: "read_note", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_a",
            content: "Screenshot attached below.",
          },
          {
            type: "tool_result",
            tool_use_id: "toolu_b",
            content: "Buy milk.",
          },
          { type: "text", text: "The screenshot:" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "AAAA" },
          },
        ],
      },
    ]);
  });

  it("offers tools by name, description and input schema, and never forces one", async () => {
    const body = await sentBody({
      messages: [{ role: "user", content: "Hello" }],
      tools: [
        {
          name: "read_note",
          description: "Reads the note.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    expect(body["tools"]).toEqual([
      {
        name: "read_note",
        description: "Reads the note.",
        input_schema: { type: "object", properties: {} },
      },
    ]);
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("gives a call id the format does not accept the same safe form in the call and in its result", async () => {
    const body = await sentBody({
      messages: [
        { role: "user", content: "Read it." },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "functions.read_note:0", name: "read_note", arguments: "" },
          ],
        },
        {
          role: "tool",
          toolCallId: "functions.read_note:0",
          name: "read_note",
          content: "Buy milk.",
        },
      ],
    });

    expect(body["messages"]).toMatchObject([
      {},
      {
        content: [{ type: "tool_use", id: "functions_read_note_0", input: {} }],
      },
      {
        content: [
          { type: "tool_result", tool_use_id: "functions_read_note_0" },
        ],
      },
    ]);
  });

  it("sends a system message that arrives mid-conversation as text in the user's turn", async () => {
    const body = await sentBody({
      messages: [
        { role: "system", content: "You are Zhiyin." },
        { role: "user", content: "Hello" },
        { role: "system", content: "The folder changed." },
      ],
    });

    expect(body["system"]).toEqual([{ type: "text", text: "You are Zhiyin." }]);
    expect(body["messages"]).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: "The folder changed." },
        ],
      },
    ]);
  });

  it("leaves out empty words, which Anthropic does not accept", async () => {
    const body = await sentBody({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "" },
        { role: "assistant", content: "Hi." },
        { role: "user", content: [{ kind: "text", text: "" }] },
        { role: "user", content: "Again" },
      ],
    });

    expect(body["messages"]).toEqual([
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi." }] },
      { role: "user", content: [{ type: "text", text: "Again" }] },
    ]);
  });
});

describe("cache marks", () => {
  it("mark the last block of each message named in cacheAfter, the system prompt included", async () => {
    const body = await sentBody({ messages: readNote, cacheAfter: [1, 3, 5] });
    const marker = { type: "ephemeral" };

    expect(body["system"]).toEqual([
      { type: "text", text: "You are Zhiyin." },
      {
        type: "text",
        text: "Available skills: none.",
        cache_control: marker,
      },
    ]);
    expect(body["messages"]).toEqual([
      { role: "user", content: [{ type: "text", text: "Read the note." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Reading it." },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_note",
            input: { name: "todo" },
            cache_control: marker,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: "Buy milk.",
          },
          { type: "text", text: "Thanks.", cache_control: marker },
        ],
      },
    ]);
  });

  it("are at most four, the latest kept, since Anthropic accepts no more", async () => {
    const body = await sentBody({
      messages: [
        { role: "user", content: "1" },
        { role: "assistant", content: "2" },
        { role: "user", content: "3" },
        { role: "assistant", content: "4" },
        { role: "user", content: "5" },
      ],
      cacheAfter: [0, 1, 2, 3, 4],
    });

    const marked = (body["messages"] as { content: { text: string }[] }[])
      .flatMap((turn) => turn.content)
      .filter((part) => "cache_control" in part)
      .map((part) => part.text);
    expect(marked).toEqual(["2", "3", "4", "5"]);
  });

  it("are not sent when the request names none", async () => {
    const body = await sentBody({ messages: readNote });

    expect(JSON.stringify(body)).not.toContain("cache_control");
  });

  it("go nowhere for a message that sends nothing", async () => {
    const body = await sentBody({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "" },
      ],
      cacheAfter: [1],
    });

    expect(JSON.stringify(body)).not.toContain("cache_control");
  });
});
