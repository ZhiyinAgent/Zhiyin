/**
 * One request over Anthropic Messages, streamed back as the client's events.
 * What differs between providers that speak it (headers, the model's own
 * settings, how a failure reads, whether replayed thinking depends on what
 * came before it) is the dialect's; how the conversation is sent and the
 * stream is read is the same for all of them.
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
} from "../../model-client.js";
import type { SendInput } from "../../provider.js";
import { serverSentEvents, withoutStalling } from "../../stream.js";
import { AnswerReader, type StopDetails, type StreamEvent } from "./answer.js";
import { anthropicConversation } from "./messages.js";
import { replayOf } from "./replay.js";

/** How one provider speaks Anthropic Messages. */
export type AnthropicMessagesDialect = {
  /** How the person reads the provider's name in a failure. */
  readonly name: string;
  /** The provider a turn's replay record names, so it goes back only there. */
  readonly provider: string;
  /**
   * A replayed thinking block is refused once anything sent before it
   * changed, so a turn's thinking goes back only while nothing has.
   */
  readonly thinkingBoundToPrefix: boolean;
  /**
   * False where the provider caches a repeated start by itself, and a mark
   * would only make it bill a cache write.
   */
  readonly cacheMarks?: false;
  headers(apiKey: string): Readonly<Record<string, string>>;
  /**
   * Everything the request carries beside the conversation, the tools and
   * streaming: the model, the longest reply, how it thinks.
   */
  settings(
    chosen: ModelChoiceValue,
    request: ModelRequest,
  ): Readonly<Record<string, unknown>>;
  classify(failure: FailureReport): ModelClientError;
};

/** A stop reason the client reads as an answer cut off before its end. */
const cutOff = new Set(["max_tokens", "model_context_window_exceeded"]);

/**
 * A refusal is a stop reason, not an error, but what arrived before it is to
 * be discarded: it ends the request as refused.
 */
function refused(name: string, details: StopDetails | undefined) {
  return new ModelClientError(
    "refused",
    details?.explanation
      ? `${name} declined the request: ${details.explanation}`
      : `${name} declined the request.`,
    {
      provider: {
        errorType: "refusal",
        ...(details?.category ? { reasons: [details.category] } : {}),
      },
    },
  );
}

export async function* sendAnthropicMessages(
  dialect: AnthropicMessagesDialect,
  input: SendInput,
): AsyncIterable<ModelEvent> {
  const { chosen, request } = input;
  const conversation = anthropicConversation(
    request.messages,
    request.tools ?? [],
    {
      provider: dialect.provider,
      thinkingBoundToPrefix: dialect.thinkingBoundToPrefix,
      ...(request.cacheAfter && dialect.cacheMarks !== false
        ? { cacheAfter: request.cacheAfter }
        : {}),
    },
  );
  const body = {
    ...dialect.settings(chosen, request),
    stream: true,
    ...(conversation.system.length ? { system: conversation.system } : {}),
    messages: conversation.messages,
    ...(conversation.tools.length ? { tools: conversation.tools } : {}),
  };

  let response: ModelFetchResponse;
  try {
    response = await input.fetcher(input.endpoint, {
      method: "POST",
      headers: dialect.headers(input.apiKey),
      body: JSON.stringify(body),
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
  if (!response.body)
    throw new ModelClientError(
      "malformedResponse",
      `${dialect.name} returned an empty response stream.`,
    );

  const answer = new AnswerReader();
  for await (const data of serverSentEvents(
    withoutStalling(response.body, input.stallTimeoutMs, dialect.name),
  )) {
    let event: StreamEvent & { readonly error?: ProviderError };
    try {
      event = JSON.parse(data) as typeof event;
    } catch (error) {
      throw new ModelClientError(
        "malformedResponse",
        `${dialect.name} returned an unreadable response.`,
        { cause: error },
      );
    }
    // A failure after the status line went out as 200. What arrived before it
    // was passed on; the request still ends as the failure it is.
    if (event.type === "error")
      throw dialect.classify({
        status: 0,
        ...(event.error ? { error: event.error } : {}),
        model: chosen.model,
        inStream: true,
      });
    yield* answer.read(event);
    if (answer.stopped) break;
  }

  // The stop reason or `message_stop` ends an answer; a connection that
  // closed before either left one that cannot be trusted as finished.
  if (answer.stopReason === undefined && !answer.stopped)
    throw new ModelClientError(
      "malformedResponse",
      `${dialect.name} ended the response before completion.`,
    );
  const usage = answer.usage();
  if (usage) yield { kind: "usage", usage };
  if (answer.stopReason === "refusal")
    throw refused(dialect.name, answer.stopDetails);

  const finishReason =
    answer.stopReason !== undefined && cutOff.has(answer.stopReason)
      ? "length"
      : answer.stopReason;
  const record = answer.record(conversation.prefix);
  yield {
    kind: "done",
    ...(finishReason === undefined ? {} : { finishReason }),
    response: {
      ...(answer.id ? { requestId: answer.id } : {}),
      ...(answer.model ? { model: answer.model } : {}),
      finishReason: finishReason ?? null,
      termination: finishReason === undefined ? "sentinel" : "finishReason",
      complete: finishReason !== "length" && answer.usable,
    },
    ...(record ? { replay: replayOf(dialect.provider, record) } : {}),
  };
}
