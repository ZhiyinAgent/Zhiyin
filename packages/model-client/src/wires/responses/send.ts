/**
 * One request over the Responses API, streamed back as the client's events.
 * What differs between providers that speak it (how a request is put
 * together, how a failure reads) is the dialect's; how the stream is read is
 * the same for all of them.
 *
 * The stream is typed events (streaming events reference and the official
 * openai-node types, checked 2026-10-09). It ends with `response.completed`,
 * `response.incomplete` or `response.failed`; usage arrives only on that
 * last response, and a failure after the status went out arrives as
 * `response.failed` or an `error` event.
 */

import type { ModelChoiceValue } from "../../choice.js";
import {
  ModelClientError,
  refusalBody,
  type FailureReport,
  type ProviderError,
} from "../../failures.js";
import type {
  ModelEvent,
  ModelFetchResponse,
  ModelRequest,
  ModelUsage,
} from "../../model-client.js";
import type { SendInput } from "../../provider.js";
import { serverSentEvents, withoutStalling } from "../../stream.js";
import { responsesFormat, type ResponsesReplayData } from "./input.js";

/** How one provider speaks the Responses API. */
export type ResponsesDialect = {
  /** How the person reads the provider's name in a failure. */
  readonly name: string;
  /** The provider's id, which names it in the replay records it writes. */
  readonly provider: string;
  headers(apiKey: string): Readonly<Record<string, string>>;
  body(chosen: ModelChoiceValue, request: ModelRequest): unknown;
  classify(failure: FailureReport): ModelClientError;
};

type Item = Readonly<Record<string, unknown>> & { readonly type: string };

type ResponseObject = {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
  readonly incomplete_details?: { readonly reason?: unknown } | null;
  readonly output?: unknown;
  readonly usage?: {
    readonly input_tokens?: unknown;
    readonly output_tokens?: unknown;
    readonly total_tokens?: unknown;
    readonly input_tokens_details?: {
      readonly cached_tokens?: unknown;
      readonly cache_write_tokens?: unknown;
    };
    readonly output_tokens_details?: { readonly reasoning_tokens?: unknown };
  } | null;
};

type StreamEvent = {
  readonly type?: unknown;
  readonly delta?: unknown;
  readonly output_index?: unknown;
  readonly item_id?: unknown;
  readonly summary_index?: unknown;
  readonly item?: unknown;
  readonly response?: ResponseObject;
  readonly code?: unknown;
  readonly message?: unknown;
};

/** The output items a turn is continued from. Others are not sent back. */
const replayedTypes: ReadonlySet<string> = new Set([
  "reasoning",
  "message",
  "function_call",
]);

function isItem(value: unknown): value is Item {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** The failure as the classifier reads it: a code and a sentence. */
function failureOf(code: unknown, message: unknown): ProviderError {
  return {
    ...(code === undefined || code === null ? {} : { code }),
    ...(message === undefined ? {} : { message }),
  };
}

/** What the request used, counting cached input inside the input. */
function usageOf(
  response: ResponseObject,
  requestId: string | undefined,
  model: string | undefined,
): ModelUsage | undefined {
  const usage = response.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const read = count(usage.input_tokens_details?.cached_tokens);
  const written = count(usage.input_tokens_details?.cache_write_tokens);
  const reasoning = count(usage.output_tokens_details?.reasoning_tokens);
  return {
    requestId: requestId ?? "unknown",
    model: model ?? "unknown",
    inputTokens: count(usage.input_tokens) ?? 0,
    outputTokens: count(usage.output_tokens) ?? 0,
    totalTokens: count(usage.total_tokens) ?? 0,
    ...(read === undefined ? {} : { cacheReadTokens: read }),
    ...(written === undefined ? {} : { cacheWriteTokens: written }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  };
}

/**
 * Why the response ended, in the client's terms: an answer cut off at the
 * output limit is `length`; any other incomplete one keeps OpenAI's reason.
 */
function finishOf(ended: string, response: ResponseObject): string {
  if (ended === "response.completed") return "completed";
  const reason = response.incomplete_details?.reason;
  if (reason === "max_output_tokens") return "length";
  return typeof reason === "string" ? reason : "incomplete";
}

/** A function call being assembled: its place among the turn's calls. */
type CallInProgress = { readonly index: number; streamed: string };

export async function* sendResponses(
  dialect: ResponsesDialect,
  input: SendInput,
): AsyncIterable<ModelEvent> {
  const { chosen, request } = input;
  let response: ModelFetchResponse;
  try {
    response = await input.fetcher(input.endpoint, {
      method: "POST",
      headers: dialect.headers(input.apiKey),
      body: JSON.stringify(dialect.body(chosen, request)),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } catch (error) {
    // Cancelled by the caller, which is not a connection that failed.
    if (request.signal?.aborted) throw request.signal.reason;
    throw new ModelClientError(
      "networkFailure",
      `Could not reach ${dialect.name}. Check the connection and try again.`,
      { cause: error },
    );
  }

  if (!response.ok)
    throw dialect.classify({
      status: response.status,
      headers: response.headers,
      model: chosen.model,
      ...(await refusalBody(response.body).then((error) =>
        error ? { error } : {},
      )),
    });
  if (!response.body) {
    throw new ModelClientError(
      "malformedResponse",
      `${dialect.name} returned an empty response stream.`,
    );
  }

  let requestId: string | undefined;
  let responseModel: string | undefined;
  const noteResponse = (about: ResponseObject | undefined) => {
    if (typeof about?.id === "string") requestId = about.id;
    if (typeof about?.model === "string") responseModel = about.model;
  };
  let sawUsableOutput = false;
  /** Which summary part the reasoning last streamed from. */
  let summaryPart: string | undefined;
  const calls = new Map<number, CallInProgress>();
  /** Finished output items, by their place in the response's output. */
  const finished = new Map<number, Item>();
  let ended:
    { readonly type: string; readonly response: ResponseObject } | undefined;

  /** A function call's first sight: its id and name, and any arguments. */
  function* callStarted(at: number, item: Item): Iterable<ModelEvent> {
    const call = { index: calls.size, streamed: "" };
    calls.set(at, call);
    sawUsableOutput = true;
    yield {
      kind: "toolCallDelta",
      index: call.index,
      ...(typeof item["call_id"] === "string"
        ? { callId: item["call_id"] }
        : {}),
      ...(typeof item["name"] === "string" ? { name: item["name"] } : {}),
    };
  }

  /** Arguments the finished call holds beyond what streamed. */
  function* callFinished(
    call: CallInProgress,
    item: Item,
  ): Iterable<ModelEvent> {
    const whole = item["arguments"];
    if (
      typeof whole !== "string" ||
      whole.length <= call.streamed.length ||
      !whole.startsWith(call.streamed)
    )
      return;
    const rest = whole.slice(call.streamed.length);
    call.streamed = whole;
    yield { kind: "toolCallDelta", index: call.index, argumentsDelta: rest };
  }

  for await (const data of serverSentEvents(
    withoutStalling(response.body, input.stallTimeoutMs, dialect.name),
  )) {
    let event: StreamEvent;
    try {
      event = JSON.parse(data) as StreamEvent;
    } catch (error) {
      throw new ModelClientError(
        "malformedResponse",
        `${dialect.name} returned an unreadable response.`,
        { cause: error },
      );
    }
    const at = count(event.output_index);

    switch (event.type) {
      case "response.created":
      case "response.in_progress":
        noteResponse(event.response);
        break;
      case "response.output_text.delta":
      case "response.refusal.delta":
        if (typeof event.delta !== "string") break;
        if (event.delta) sawUsableOutput = true;
        yield { kind: "textDelta", text: event.delta };
        break;
      case "response.reasoning_summary_text.delta": {
        if (typeof event.delta !== "string" || !event.delta) break;
        const part = `${String(event.item_id)}:${String(event.summary_index)}`;
        const between =
          summaryPart !== undefined && summaryPart !== part ? "\n\n" : "";
        summaryPart = part;
        yield { kind: "reasoningDelta", text: between + event.delta };
        break;
      }
      case "response.output_item.added":
        if (at === undefined || !isItem(event.item)) break;
        if (event.item.type === "function_call") {
          yield* callStarted(at, event.item);
          const call = calls.get(at);
          if (call) yield* callFinished(call, event.item);
        }
        break;
      case "response.function_call_arguments.delta": {
        const call = at === undefined ? undefined : calls.get(at);
        if (!call || typeof event.delta !== "string" || !event.delta) break;
        call.streamed += event.delta;
        yield {
          kind: "toolCallDelta",
          index: call.index,
          argumentsDelta: event.delta,
        };
        break;
      }
      case "response.output_item.done": {
        if (at === undefined || !isItem(event.item)) break;
        // The finished item is the one to send back: while it streamed, its
        // encrypted reasoning may not have been whole.
        if (replayedTypes.has(event.item.type)) finished.set(at, event.item);
        if (event.item.type !== "function_call") break;
        if (!calls.has(at)) yield* callStarted(at, event.item);
        const call = calls.get(at);
        if (call) yield* callFinished(call, event.item);
        break;
      }
      case "response.completed":
      case "response.incomplete":
        ended = { type: event.type, response: event.response ?? {} };
        break;
      case "response.failed":
        throw dialect.classify({
          status: 0,
          error: failureOf(
            event.response?.error?.code,
            event.response?.error?.message,
          ),
          model: chosen.model,
          inStream: true,
        });
      case "error":
        throw dialect.classify({
          status: 0,
          error: failureOf(event.code, event.message),
          model: chosen.model,
          inStream: true,
        });
    }
    // Nothing after the response's end belongs to it.
    if (ended) break;
  }

  if (!ended) {
    throw new ModelClientError(
      "malformedResponse",
      `${dialect.name} ended the response before completion.`,
    );
  }
  noteResponse(ended.response);
  const usage = usageOf(ended.response, requestId, responseModel);
  if (usage) yield { kind: "usage", usage };

  const items = finished.size
    ? [...finished.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, item]) => item)
    : Array.isArray(ended.response.output)
      ? (ended.response.output as unknown[]).filter(
          (item): item is Item => isItem(item) && replayedTypes.has(item.type),
        )
      : [];
  const data: ResponsesReplayData = { output: items };
  const finishReason = finishOf(ended.type, ended.response);
  yield {
    kind: "done",
    finishReason,
    response: {
      ...(requestId ? { requestId } : {}),
      ...(responseModel ? { model: responseModel } : {}),
      finishReason,
      termination: "finishReason",
      complete: ended.type === "response.completed" && sawUsableOutput,
    },
    ...(items.length
      ? {
          replay: { provider: dialect.provider, format: responsesFormat, data },
        }
      : {}),
  };
}
