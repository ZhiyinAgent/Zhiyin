/**
 * A turn's thinking goes back to the provider and format that wrote it, as it
 * arrived (ADR 0024). From Anthropic's thinking and preserved thinking guides
 * (checked 2026-10-09): signed and redacted thinking blocks go back unchanged
 * and in their original order; a block stays valid only while the system
 * prompt, the tools and every message before it are unchanged; and thinking
 * may be left out from the start of the history, from the end, or entirely,
 * never from the middle of what the model last saw.
 */

import { describe, expect, it } from "vitest";
import type { ModelReplay } from "@zhiyin/contract";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
  ModelTool,
} from "../src/model-client.js";
import {
  answering,
  block,
  labDialect,
  message,
  recording,
  sendOnce,
  sentBody,
  type Sent,
} from "./anthropic-messages-support.js";

type AssistantTurn = Extract<ModelMessage, { role: "assistant" }>;

/** The turn an answer becomes, assembled as the agent loop assembles it. */
function turnFrom(events: readonly ModelEvent[]): AssistantTurn {
  let content = "";
  let reasoning = "";
  let replay: ModelReplay | undefined;
  const calls = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  for (const event of events) {
    if (event.kind === "textDelta") content += event.text;
    else if (event.kind === "reasoningDelta") reasoning += event.text;
    else if (event.kind === "toolCallDelta") {
      const call = calls.get(event.index) ?? {
        id: "",
        name: "",
        arguments: "",
      };
      if (event.callId) call.id = event.callId;
      if (event.name) call.name += event.name;
      if (event.argumentsDelta) call.arguments += event.argumentsDelta;
      calls.set(event.index, call);
    } else if (event.kind === "done") replay = event.replay;
  }
  return {
    role: "assistant",
    content,
    ...(reasoning ? { reasoning } : {}),
    ...(calls.size ? { toolCalls: [...calls.values()] } : {}),
    ...(replay ? { replay } : {}),
  };
}

/** Sends `request`, answered by `answer`; returns what was sent and the turn. */
async function exchange(
  request: ModelRequest,
  answer: Record<string, unknown>[],
  dialect = labDialect(),
) {
  const sent: Sent[] = [];
  const events = await sendOnce(request, {
    fetcher: recording(sent, answering(answer)),
    dialect,
  });
  return { body: sent[0]?.body ?? {}, turn: turnFrom(events), events };
}

/** For each assistant turn sent, the thinking it carried. */
function thinkingSent(body: Record<string, unknown>): string[][] {
  const turns = body["messages"] as {
    role: string;
    content: Record<string, unknown>[];
  }[];
  return turns
    .filter((turn) => turn.role === "assistant")
    .map((turn) =>
      turn.content
        .filter((part) => String(part["type"]).endsWith("thinking"))
        .map((part) => String(part["signature"] ?? part["data"])),
    );
}

const readNoteTool: ModelTool = {
  name: "read_note",
  description: "Reads the note.",
  inputSchema: { type: "object" },
};

describe("a turn's thinking", () => {
  it("is kept as a replay record for the provider and format that wrote it, and goes back exactly as it arrived", async () => {
    const first = await exchange(
      { messages: [{ role: "user", content: "Read the note." }] },
      message(
        [
          block.thinking(0, "Plan the reading.", "sig-1"),
          block.redacted(1, "opaque-1"),
          block.text(2, "Reading."),
          block.toolUse(3, "toolu_1", "read_note", '{"name":"todo"}'),
        ],
        "tool_use",
      ),
    );

    expect(first.events.at(-1)).toMatchObject({
      kind: "done",
      replay: { provider: "test-lab", format: "anthropic-messages" },
    });

    const body = await sentBody({
      messages: [
        { role: "user", content: "Read the note." },
        first.turn,
        {
          role: "tool",
          toolCallId: "toolu_1",
          name: "read_note",
          content: "Buy milk.",
        },
      ],
    });

    expect((body["messages"] as unknown[])[1]).toEqual({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "Plan the reading.",
          signature: "sig-1",
        },
        { type: "redacted_thinking", data: "opaque-1" },
        { type: "text", text: "Reading." },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "read_note",
          input: { name: "todo" },
        },
      ],
    });
  });

  it("goes back in the order it came, between the words and the calls", async () => {
    const { turn } = await exchange(
      { messages: [{ role: "user", content: "Read both notes." }] },
      message(
        [
          block.thinking(0, "Two notes.", "sig-1"),
          block.text(1, "Reading "),
          block.text(2, "both."),
          block.thinking(3, "First the list.", "sig-2"),
          block.toolUse(4, "toolu_a", "list_notes", "{}"),
          block.thinking(5, "Then the note.", "sig-3"),
          block.toolUse(6, "toolu_b", "read_note", "{}"),
        ],
        "tool_use",
      ),
    );

    const body = await sentBody({
      messages: [{ role: "user", content: "Read both notes." }, turn],
    });

    expect((body["messages"] as { content: unknown[] }[])[1]?.content).toEqual([
      { type: "thinking", thinking: "Two notes.", signature: "sig-1" },
      { type: "text", text: "Reading " },
      { type: "text", text: "both." },
      { type: "thinking", thinking: "First the list.", signature: "sig-2" },
      { type: "tool_use", id: "toolu_a", name: "list_notes", input: {} },
      { type: "thinking", thinking: "Then the note.", signature: "sig-3" },
      { type: "tool_use", id: "toolu_b", name: "read_note", input: {} },
    ]);
  });

  it("leaves no record when the turn had no thinking", async () => {
    const { events } = await exchange(
      { messages: [{ role: "user", content: "Hello" }] },
      message([block.text(0, "Hi.")]),
    );

    expect(events.at(-1)).not.toHaveProperty("replay");
  });

  it("leaves no record when a thinking block arrived without its signature, which Anthropic would refuse", async () => {
    const { events } = await exchange(
      { messages: [{ role: "user", content: "Hello" }] },
      message([
        [
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "thinking", thinking: "", signature: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "thinking_delta", thinking: "Hmm." },
          },
          { type: "content_block_stop", index: 0 },
        ],
        block.text(1, "Hi."),
      ]),
    );

    expect(events.at(-1)).not.toHaveProperty("replay");
  });

  it("goes back only to the provider and format that wrote it; any other record, or one that cannot be read, is left out", async () => {
    const { turn } = await exchange(
      { messages: [{ role: "user", content: "Hello" }] },
      message([block.thinking(0, "Greet.", "sig-1"), block.text(1, "Hi.")]),
    );
    const replay = turn.replay as ModelReplay;

    for (const other of [
      { ...replay, provider: "other-lab" },
      { ...replay, format: "chat-completions" },
      { ...replay, data: "not a record" },
      { ...replay, data: { blocks: [{ type: "thinking" }] } },
    ]) {
      const body = await sentBody({
        messages: [
          { role: "user", content: "Hello" },
          { ...turn, replay: other },
          { role: "user", content: "Again" },
        ],
      });

      expect((body["messages"] as unknown[])[1]).toEqual({
        role: "assistant",
        content: [{ type: "text", text: "Hi." }],
      });
    }
  });

  it("is left out for turns written before an earlier part of the conversation changed, and kept for turns written after", async () => {
    const system: ModelMessage = { role: "system", content: "You are Zhiyin." };
    const ask: ModelMessage = { role: "user", content: "Read the note." };
    const tools = [readNoteTool];
    const result = (content: string): ModelMessage => ({
      role: "tool",
      toolCallId: "toolu_1",
      name: "read_note",
      content,
    });

    const first = await exchange(
      { messages: [system, ask], tools },
      message(
        [
          block.thinking(0, "Read it.", "sig-1"),
          block.toolUse(1, "toolu_1", "read_note", "{}"),
        ],
        "tool_use",
      ),
    );
    const second = await exchange(
      { messages: [system, ask, first.turn, result("Buy milk.")], tools },
      message([
        block.thinking(0, "Answer.", "sig-2"),
        block.text(1, "It says buy milk."),
      ]),
    );
    const asked: ModelMessage = { role: "user", content: "Anything else?" };
    const conversation = [
      system,
      ask,
      first.turn,
      result("Buy milk."),
      second.turn,
      asked,
    ];

    // Nothing changed: every turn goes back with its thinking.
    expect(
      thinkingSent(await sentBody({ messages: conversation, tools })),
    ).toEqual([["sig-1"], ["sig-2"]]);

    // The old tool result was cleared: the first turn came before it and
    // keeps its thinking; the second was written after the original result.
    const cleared = conversation.map((each) =>
      each.role === "tool" ? result("Cleared; read it again if needed.") : each,
    );
    const third = await exchange(
      { messages: cleared, tools },
      message([
        block.thinking(0, "Nothing else.", "sig-3"),
        block.text(1, "That is all."),
      ]),
    );
    expect(thinkingSent(third.body)).toEqual([["sig-1"], []]);

    // A turn written after the change keeps its thinking from then on.
    const after = await sentBody({
      messages: [...cleared, third.turn, { role: "user", content: "Thanks." }],
      tools,
    });
    expect(thinkingSent(after)).toEqual([["sig-1"], [], ["sig-3"]]);

    // A changed system prompt or tool comes before every turn.
    expect(
      thinkingSent(
        await sentBody({
          messages: [
            { ...system, content: "You are Zhiyin. Today is Friday." },
            ...conversation.slice(1),
          ],
          tools,
        }),
      ),
    ).toEqual([[], []]);
    expect(
      thinkingSent(
        await sentBody({
          messages: conversation,
          tools: [{ ...readNoteTool, description: "Reads a note." }],
        }),
      ),
    ).toEqual([[], []]);
  });

  it("is left out for a turn whose words or calls changed after it arrived", async () => {
    const { turn } = await exchange(
      { messages: [{ role: "user", content: "Read the note." }] },
      message(
        [
          block.thinking(0, "Read it.", "sig-1"),
          block.toolUse(1, "toolu_1", "read_note", '{"name":"todo"}'),
        ],
        "tool_use",
      ),
    );
    const rewritten: AssistantTurn = {
      ...turn,
      toolCalls: [
        { id: "toolu_1", name: "read_note", arguments: '{"name":"todo.md"}' },
      ],
    };

    const body = await sentBody({
      messages: [
        { role: "user", content: "Read the note." },
        rewritten,
        {
          role: "tool",
          toolCallId: "toolu_1",
          name: "read_note",
          content: "Buy milk.",
        },
      ],
    });

    expect((body["messages"] as unknown[])[1]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "read_note",
          input: { name: "todo.md" },
        },
      ],
    });
  });

  it("stays after a change for a dialect whose thinking does not depend on what came before it", async () => {
    const dialect = labDialect([], { thinkingBoundToPrefix: false });
    const first = await exchange(
      { messages: [{ role: "user", content: "Hello" }] },
      message([block.thinking(0, "Greet.", "sig-1"), block.text(1, "Hi.")]),
      dialect,
    );

    const body = await sentBody(
      {
        messages: [
          { role: "system", content: "A new system prompt." },
          { role: "user", content: "Hello" },
          first.turn,
          { role: "user", content: "Again" },
        ],
      },
      dialect,
    );

    expect(thinkingSent(body)).toEqual([["sig-1"]]);
  });

  it("is never marked for the cache: a mark on a turn that ends in thinking goes on its last other block", async () => {
    const { turn } = await exchange(
      { messages: [{ role: "user", content: "Read the note." }] },
      message(
        [
          block.toolUse(0, "toolu_1", "read_note", "{}"),
          block.thinking(1, "", "sig-1"),
        ],
        "max_tokens",
      ),
    );

    const body = await sentBody({
      messages: [{ role: "user", content: "Read the note." }, turn],
      cacheAfter: [1],
    });

    expect((body["messages"] as { content: unknown[] }[])[1]?.content).toEqual([
      {
        type: "tool_use",
        id: "toolu_1",
        name: "read_note",
        input: {},
        cache_control: { type: "ephemeral" },
      },
      { type: "thinking", thinking: "", signature: "sig-1" },
    ]);
  });
});
