/**
 * One request over Chat Completions, streamed back as the client's events.
 * What differs between providers that speak it (how a request is put
 * together, how a refusal reads) is the dialect's; how the stream is read is
 * the same for all of them.
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
import { usageFrom } from "./messages.js";

/** How one provider speaks Chat Completions. */
export type ChatCompletionsDialect = {
  /** How the person reads the provider's name in a failure. */
  readonly name: string;
  headers(apiKey: string): Readonly<Record<string, string>>;
  body(chosen: ModelChoiceValue, request: ModelRequest): unknown;
  classify(failure: FailureReport): ModelClientError;
  /**
   * Where a refused request's body explains itself, for a provider that does
   * not put it under `error`.
   */
  readonly refusal?: (body: unknown) => ProviderError | undefined;
  /**
   * The reasoning and words in a delta's `content`, for a provider that
   * sends it as more than plain text. Without it, only text is read there.
   */
  readonly content?: (content: unknown) => {
    readonly reasoning: string;
    readonly text: string;
  };
  /**
   * The failure a finish reason names, for a provider that reports a failure
   * inside a 200 stream as the reason the answer stopped. Undefined for a
   * reason that ends an answer.
   */
  readonly failedFinish?: (reason: string) => ModelClientError | undefined;
};

type ProviderChunk = {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly provider?: unknown;
  /**
   * A failure the provider could not put in the status line, because the status
   * line went out with the headers before anything went wrong. Carries the same
   * numeric codes an HTTP failure would.
   */
  readonly error?: ProviderError;
  readonly choices?: readonly {
    readonly delta?: {
      readonly reasoning?: unknown;
      readonly reasoning_content?: unknown;
      readonly reasoning_details?: readonly {
        readonly type?: unknown;
        readonly text?: unknown;
        readonly summary?: unknown;
      }[];
      readonly content?: unknown;
      readonly tool_calls?: readonly {
        readonly index?: unknown;
        readonly id?: unknown;
        readonly function?: {
          readonly name?: unknown;
          readonly arguments?: unknown;
        };
      }[];
    };
    readonly finish_reason?: unknown;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly total_tokens?: unknown;
    readonly cost?: unknown;
  };
};

type Delta = NonNullable<
  NonNullable<ProviderChunk["choices"]>[number]["delta"]
>;

/** Readable reasoning, from whichever of its forms the provider sent. */
function reasoningIn(delta: Delta | undefined): string {
  if (typeof delta?.reasoning === "string" && delta.reasoning)
    return delta.reasoning;
  if (typeof delta?.reasoning_content === "string" && delta.reasoning_content)
    return delta.reasoning_content;
  if (!Array.isArray(delta?.reasoning_details)) return "";
  return delta.reasoning_details
    .map((detail) =>
      !detail || typeof detail !== "object"
        ? ""
        : detail.type === "reasoning.text" && typeof detail.text === "string"
          ? detail.text
          : detail.type === "reasoning.summary" &&
              typeof detail.summary === "string"
            ? detail.summary
            : "",
    )
    .join("");
}

export async function* sendChatCompletions(
  dialect: ChatCompletionsDialect,
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
      ...(await refusalBody(response.body, dialect.refusal).then((error) =>
        error ? { error } : {},
      )),
    });
  if (!response.body) {
    throw new ModelClientError(
      "malformedResponse",
      `${dialect.name} returned an empty response stream.`,
    );
  }

  // Three independent signals that the provider is done: its `[DONE]`
  // sentinel, a `finish_reason` on a choice, and the usage chunk it sends
  // last. Requiring the sentinel alone would discard an answer that plainly
  // finished whenever a connection closes a beat early, which is not rare,
  // and lose a whole turn's work.
  let sawDone = false;
  let finishReason: string | undefined;
  let sawUsage = false;
  let requestId: string | undefined;
  let responseModel: string | undefined;
  let provider: string | undefined;
  let sawUsableOutput = false;
  for await (const data of serverSentEvents(
    withoutStalling(response.body, input.stallTimeoutMs, dialect.name),
  )) {
    if (data === "[DONE]") {
      sawDone = true;
      break;
    }

    let chunk: ProviderChunk;
    try {
      chunk = JSON.parse(data) as ProviderChunk;
    } catch (error) {
      throw new ModelClientError(
        "malformedResponse",
        `${dialect.name} returned an unreadable response.`,
        { cause: error },
      );
    }

    // A failure the provider could not put in the status line. It has to end
    // the request: the alternative is a turn that stops early, keeps whatever
    // arrived before it, and is recorded as a completed answer - with the
    // provider's own explanation of what went wrong read and discarded.
    if (chunk.error) {
      throw dialect.classify({
        status: typeof chunk.error.code === "number" ? chunk.error.code : 0,
        error: chunk.error,
        model: chosen.model,
        inStream: true,
      });
    }

    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if (typeof chunk.id === "string") requestId = chunk.id;
    if (typeof chunk.model === "string") responseModel = chunk.model;
    if (typeof chunk.provider === "string") provider = chunk.provider;
    const content = dialect.content?.(delta?.content);
    const reasoning = reasoningIn(delta) + (content?.reasoning ?? "");
    if (reasoning) yield { kind: "reasoningDelta", text: reasoning };
    const text = content ? content.text || undefined : delta?.content;
    if (typeof text === "string") {
      if (text) sawUsableOutput = true;
      yield { kind: "textDelta", text };
    }
    for (const toolCall of delta?.tool_calls ?? []) {
      if (typeof toolCall.index !== "number") continue;
      sawUsableOutput = true;
      yield {
        kind: "toolCallDelta",
        index: toolCall.index,
        ...(typeof toolCall.id === "string" ? { callId: toolCall.id } : {}),
        ...(typeof toolCall.function?.name === "string"
          ? { name: toolCall.function.name }
          : {}),
        ...(typeof toolCall.function?.arguments === "string"
          ? { argumentsDelta: toolCall.function.arguments }
          : {}),
      };
    }
    if (typeof choice?.finish_reason === "string")
      finishReason = choice.finish_reason;
    const usage = usageFrom(chunk);
    if (usage) {
      sawUsage = true;
      yield {
        kind: "usage",
        usage: provider ? { ...usage, provider } : usage,
      };
    }
  }

  // A failure the provider could only name as the reason the answer stopped.
  // Like an error chunk, it ends the request rather than being kept as a
  // finished answer. It is checked once the stream has ended, so the usage
  // that came with or after the finish reason, which was still spent, is
  // passed on first.
  const failed =
    finishReason === undefined
      ? undefined
      : dialect.failedFinish?.(finishReason);
  if (failed) throw failed;
  if (!sawDone && finishReason === undefined && !sawUsage) {
    throw new ModelClientError(
      "malformedResponse",
      `${dialect.name} ended the response before completion.`,
    );
  }
  const termination =
    finishReason !== undefined
      ? ("finishReason" as const)
      : sawDone
        ? ("sentinel" as const)
        : ("usage" as const);
  const complete =
    termination !== "usage" && finishReason !== "length" && sawUsableOutput;
  yield {
    kind: "done",
    ...(finishReason === undefined ? {} : { finishReason }),
    response: {
      ...(requestId ? { requestId } : {}),
      ...(responseModel ? { model: responseModel } : {}),
      ...(provider ? { provider } : {}),
      finishReason: finishReason ?? null,
      termination,
      complete,
    },
  };
}
