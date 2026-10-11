/**
 * A conversation as the Responses API carries it (OpenAI's API reference,
 * text, function-calling and conversation-state guides, checked 2026-10-09).
 * Zhiyin keeps the conversation itself and sends it whole every time, so a
 * turn's replay record is what lets the provider continue from the reasoning
 * behind it: the turn's output items, sent back as they arrived.
 */

import { describe, expect, it } from "vitest";
import type { ModelReplay } from "@zhiyin/contract";
import type { ModelMessage } from "../src/model-client.js";
import {
  responsesInput,
  responsesTools,
} from "../src/wires/responses/input.js";

const provider = "lab";

describe("a conversation sent over Responses", () => {
  it("sends a system message as a developer message, where it stands", () => {
    expect(
      responsesInput(
        [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Hello" },
        ],
        provider,
      ),
    ).toEqual([
      { role: "developer", content: "Be brief." },
      { role: "user", content: "Hello" },
    ]);
  });

  it("sends a person's words and pictures as input parts, a picture as a data URL", () => {
    expect(
      responsesInput(
        [
          {
            role: "user",
            content: [
              { kind: "text", text: "What is this?" },
              { kind: "image", mediaType: "image/png", data: "AAAA" },
            ],
          },
        ],
        provider,
      ),
    ).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "What is this?" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,AAAA",
            detail: "auto",
          },
        ],
      },
    ]);
  });

  it("sends a turn without a record as its words and calls, and each result with the id of the call it answers", () => {
    expect(
      responsesInput(
        [
          { role: "user", content: "What does the note say?" },
          {
            role: "assistant",
            content: "Reading it.",
            reasoning: "Read the note first.",
            toolCalls: [{ id: "call-1", name: "read_note", arguments: "{}" }],
          },
          {
            role: "tool",
            content: "Buy milk.",
            toolCallId: "call-1",
            name: "read_note",
          },
          { role: "assistant", content: "It says to buy milk." },
        ],
        provider,
      ),
    ).toEqual([
      { role: "user", content: "What does the note say?" },
      { role: "assistant", content: "Reading it." },
      {
        type: "function_call",
        call_id: "call-1",
        name: "read_note",
        arguments: "{}",
      },
      { type: "function_call_output", call_id: "call-1", output: "Buy milk." },
      { role: "assistant", content: "It says to buy milk." },
    ]);
  });

  it("sends a turn that only called tools without an empty message before its calls", () => {
    expect(
      responsesInput(
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call-1", name: "read_note", arguments: "{}" }],
          },
        ],
        provider,
      ),
    ).toEqual([
      {
        type: "function_call",
        call_id: "call-1",
        name: "read_note",
        arguments: "{}",
      },
    ]);
  });

  it("offers each tool as a function with its schema, called best-effort rather than strictly", () => {
    expect(
      responsesTools([
        {
          name: "read_note",
          description: "Reads the note.",
          inputSchema: {
            type: "object",
            properties: { title: { type: "string" } },
          },
        },
      ]),
    ).toEqual([
      {
        type: "function",
        name: "read_note",
        description: "Reads the note.",
        parameters: {
          type: "object",
          properties: { title: { type: "string" } },
        },
        strict: false,
      },
    ]);
  });
});

/** A turn's output items as the provider finished them. */
const reasoningItem = {
  id: "rs_1",
  type: "reasoning",
  summary: [{ type: "summary_text", text: "Read the note first." }],
  encrypted_content: "sealed-reasoning",
  status: "completed",
};
const messageItem = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  status: "completed",
  phase: "commentary",
  content: [
    { type: "output_text", text: "Reading it.", annotations: [], logprobs: [] },
  ],
};
const callItem = {
  id: "fc_1",
  type: "function_call",
  status: "completed",
  call_id: "call-1",
  name: "read_note",
  arguments: '{"title":"todo"}',
};
const secondCallItem = {
  id: "fc_2",
  type: "function_call",
  status: "completed",
  call_id: "call-2",
  name: "read_note",
  arguments: '{"title":"shopping"}',
};

function recordOf(
  output: readonly unknown[],
  from: { provider?: string; format?: string } = {},
): ModelReplay {
  return {
    provider: from.provider ?? provider,
    format: from.format ?? "responses",
    data: { output },
  };
}

/** The turn as Zhiyin kept it beside its record. */
function turn(
  replay: ModelReplay,
  calls = [
    { id: "call-1", name: "read_note", arguments: '{"title":"todo"}' },
    { id: "call-2", name: "read_note", arguments: '{"title":"shopping"}' },
  ],
  content = "Reading it.",
): ModelMessage {
  return {
    role: "assistant",
    content,
    reasoning: "Read the note first.",
    toolCalls: calls,
    replay,
  };
}

describe("a turn sent back with its replay record", () => {
  it("is sent as the output items it arrived as, in their order, without the fields OpenAI marks output-only", () => {
    const record = recordOf([
      { ...reasoningItem, created_by: "model" },
      messageItem,
      callItem,
      secondCallItem,
    ]);

    expect(responsesInput([turn(record)], provider)).toEqual([
      reasoningItem,
      messageItem,
      callItem,
      secondCallItem,
    ]);
  });

  it("carries the arguments that ran where they differ from the model's draft, and leaves out a call taken back", () => {
    const record = recordOf([
      reasoningItem,
      messageItem,
      callItem,
      secondCallItem,
    ]);
    const ran = [
      { id: "call-1", name: "read_note", arguments: '{"title":"todo.md"}' },
    ];

    expect(responsesInput([turn(record, ran)], provider)).toEqual([
      reasoningItem,
      messageItem,
      {
        type: "function_call",
        call_id: "call-1",
        name: "read_note",
        arguments: '{"title":"todo.md"}',
      },
    ]);
  });

  it("carries the turn's own words, in the recorded message's place and phase, where they differ", () => {
    const record = recordOf([
      reasoningItem,
      messageItem,
      callItem,
      secondCallItem,
    ]);

    expect(
      responsesInput([turn(record, undefined, "Reading the note.")], provider),
    ).toEqual([
      reasoningItem,
      { role: "assistant", content: "Reading the note.", phase: "commentary" },
      callItem,
      secondCallItem,
    ]);
  });

  it("adds a call the record does not hold after the recorded items", () => {
    const record = recordOf([reasoningItem, callItem]);

    expect(responsesInput([turn(record, undefined, "")], provider)).toEqual([
      reasoningItem,
      callItem,
      {
        type: "function_call",
        call_id: "call-2",
        name: "read_note",
        arguments: '{"title":"shopping"}',
      },
    ]);
  });

  it("puts words the record has no message for before the turn's calls", () => {
    const record = recordOf([reasoningItem, callItem]);

    expect(responsesInput([turn(record)], provider)).toEqual([
      reasoningItem,
      { role: "assistant", content: "Reading it." },
      callItem,
      {
        type: "function_call",
        call_id: "call-2",
        name: "read_note",
        arguments: '{"title":"shopping"}',
      },
    ]);
  });

  it("is sent with its words and calls only when another provider or another format wrote the record", () => {
    const words = [
      { role: "assistant", content: "Reading it." },
      {
        type: "function_call",
        call_id: "call-1",
        name: "read_note",
        arguments: '{"title":"todo"}',
      },
    ];
    const one = [
      { id: "call-1", name: "read_note", arguments: '{"title":"todo"}' },
    ];

    for (const from of [
      { provider: "elsewhere" },
      { format: "chat-completions" },
    ])
      expect(
        responsesInput(
          [turn(recordOf([reasoningItem, messageItem, callItem], from), one)],
          provider,
        ),
      ).toEqual(words);
  });

  it("is sent with its words and calls only when its record cannot be read", () => {
    const unreadable: ModelReplay = {
      provider,
      format: "responses",
      data: "?",
    };

    expect(
      responsesInput([turn(unreadable, [], "It says to buy milk.")], provider),
    ).toEqual([{ role: "assistant", content: "It says to buy milk." }]);
  });
});
