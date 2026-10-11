/**
 * The conversation and its tools as the Responses API carries them. Zhiyin
 * keeps the conversation itself and sends all of it with every request, so
 * nothing here refers to a response the provider stored.
 *
 * A turn this provider wrote over this format goes back as the output items it
 * arrived as: OpenAI asks for every item of a stateless response to be sent
 * back, which keeps its encrypted reasoning and each message's phase (API
 * guides on conversation state and reasoning, checked 2026-10-09). The turn as
 * Zhiyin kept it still decides what was said and done: a call whose arguments
 * were changed before it ran goes back as it ran, a call taken back is left
 * out, and words that differ from the record replace its message.
 */

import type { ModelReplay } from "@zhiyin/contract";
import type {
  ModelContentPart,
  ModelMessage,
  ModelToolCall,
  ModelTool,
} from "../../model-client.js";

/** Names this format in the replay records it writes and reads. */
export const responsesFormat = "responses";

/** What a replay record of this format holds: the response's output items. */
export type ResponsesReplayData = { readonly output: readonly OutputItem[] };

/** An output item as the provider sent it, read only as far as needed. */
type OutputItem = Readonly<Record<string, unknown>> & {
  readonly type: string;
};

function userContent(content: string | readonly ModelContentPart[]) {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.kind === "text"
      ? { type: "input_text", text: part.text }
      : {
          type: "input_image",
          image_url: `data:${part.mediaType};base64,${part.data}`,
          detail: "auto",
        },
  );
}

function functionCall(call: ModelToolCall) {
  return {
    type: "function_call",
    call_id: call.id,
    name: call.name,
    arguments: call.arguments,
  };
}

/** The turn as its words and calls alone. */
function wordsAndCalls(message: Extract<ModelMessage, { role: "assistant" }>) {
  return [
    ...(message.content
      ? [{ role: "assistant", content: message.content }]
      : []),
    ...(message.toolCalls ?? []).map(functionCall),
  ];
}

/** The record's output items, where it is one of this format that can be read. */
function recordedItems(
  replay: ModelReplay | undefined,
  provider: string,
): readonly OutputItem[] | undefined {
  if (
    !replay ||
    replay.provider !== provider ||
    replay.format !== responsesFormat ||
    !replay.data ||
    typeof replay.data !== "object" ||
    !("output" in replay.data) ||
    !Array.isArray(replay.data.output)
  )
    return undefined;
  const output: readonly unknown[] = replay.data.output;
  return output.every(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as { type?: unknown }).type === "string",
  )
    ? (output as readonly OutputItem[])
    : undefined;
}

/**
 * The item as it goes back: OpenAI's own replay helper drops only
 * `created_by`, which an output item carries and an input item may not.
 */
function asSent(item: OutputItem): OutputItem {
  if (!("created_by" in item)) return item;
  return Object.fromEntries(
    Object.entries(item).filter(([field]) => field !== "created_by"),
  ) as OutputItem;
}

/** A message item's words: its text and any refusal, in order. */
function wordsOf(item: OutputItem): string {
  if (!Array.isArray(item["content"])) return "";
  return (item["content"] as readonly unknown[])
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const { text, refusal } = part as { text?: unknown; refusal?: unknown };
      return typeof text === "string"
        ? text
        : typeof refusal === "string"
          ? refusal
          : "";
    })
    .join("");
}

/** The recorded items, brought in line with the turn as Zhiyin kept it. */
function replayed(
  message: Extract<ModelMessage, { role: "assistant" }>,
  items: readonly OutputItem[],
) {
  const calls = new Map(
    (message.toolCalls ?? []).map((call) => [call.id, call]),
  );
  const sameWords =
    items
      .filter((item) => item.type === "message")
      .map(wordsOf)
      .join("") === message.content;
  const sent: unknown[] = [];
  const callsSent = new Set<string>();
  let wordsPlaced = sameWords;
  let firstCall: number | undefined;
  for (const item of items) {
    if (item.type === "reasoning") sent.push(asSent(item));
    else if (item.type === "message") {
      if (sameWords) sent.push(asSent(item));
      else if (!wordsPlaced) {
        wordsPlaced = true;
        if (message.content)
          sent.push({
            role: "assistant",
            content: message.content,
            ...(typeof item["phase"] === "string"
              ? { phase: item["phase"] }
              : {}),
          });
      }
    } else if (item.type === "function_call") {
      const call =
        typeof item["call_id"] === "string"
          ? calls.get(item["call_id"])
          : undefined;
      if (!call) continue;
      callsSent.add(call.id);
      firstCall ??= sent.length;
      sent.push(
        item["name"] === call.name && item["arguments"] === call.arguments
          ? asSent(item)
          : functionCall(call),
      );
    }
  }
  // Words the record has no message for go where words go: before the calls.
  if (!wordsPlaced && message.content)
    sent.splice(firstCall ?? sent.length, 0, {
      role: "assistant",
      content: message.content,
    });
  for (const call of message.toolCalls ?? [])
    if (!callsSent.has(call.id)) sent.push(functionCall(call));
  return sent;
}

function inputItems(message: ModelMessage, provider: string): unknown[] {
  switch (message.role) {
    case "system":
      return [{ role: "developer", content: message.content }];
    case "user":
      return [{ role: "user", content: userContent(message.content) }];
    case "assistant": {
      const items = recordedItems(message.replay, provider);
      return items ? replayed(message, items) : wordsAndCalls(message);
    }
    case "tool":
      return [
        {
          type: "function_call_output",
          call_id: message.toolCallId,
          output: message.content,
        },
      ];
  }
}

/**
 * The conversation as input items. A system message is sent as a developer
 * message where it stands: the role OpenAI's guides give an application's own
 * instructions, and a leading developer message is a place its cache may end.
 */
export function responsesInput(
  messages: readonly ModelMessage[],
  provider: string,
): unknown[] {
  return messages.flatMap((message) => inputItems(message, provider));
}

/**
 * Each tool as a function. `strict` is sent as false because Responses
 * otherwise rewrites a schema into strict mode where it can, which changes
 * what the model may leave out.
 */
export function responsesTools(tools: readonly ModelTool[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }));
}
