/**
 * How a streamed Responses answer reads back (OpenAI's streaming events
 * reference and the official openai-node types, checked 2026-10-09): typed
 * events, a terminal `response.completed`, `response.incomplete` or
 * `response.failed`, and usage only on the terminal response.
 */

import { describe, expect, it } from "vitest";
import { ModelClientError, type FailureReport } from "../src/failures.js";
import type {
  ModelEvent,
  ModelFetch,
  ModelRequest,
} from "../src/model-client.js";
import {
  sendResponses,
  type ResponsesDialect,
} from "../src/wires/responses/send.js";

const encoder = new TextEncoder();

/** Classifies every failure as refused, keeping what it was shown. */
function dialectSeeing(reports: FailureReport[] = []): ResponsesDialect {
  return {
    name: "Test Lab",
    provider: "lab",
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    body: (chosen) => ({ model: chosen.model }),
    classify: (failure) => {
      reports.push(failure);
      return new ModelClientError("refused", "Classified by the dialect.");
    },
  };
}

/** Each event as OpenAI sends it: its type on the event line, JSON as data. */
function streamOf(
  events: readonly (Readonly<Record<string, unknown>> & {
    readonly type: string;
  })[],
  after: readonly string[] = [],
): ModelFetch {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      for (const event of events)
        yield encoder.encode(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      for (const raw of after) yield encoder.encode(raw);
    })(),
  });
}

async function read(
  fetcher: ModelFetch,
  options: {
    readonly dialect?: ResponsesDialect;
    readonly request?: Partial<ModelRequest>;
    readonly stallTimeoutMs?: number;
    readonly received?: ModelEvent[];
  } = {},
): Promise<ModelEvent[]> {
  const received = options.received ?? [];
  for await (const event of sendResponses(options.dialect ?? dialectSeeing(), {
    endpoint: "https://lab.test/v1/responses",
    apiKey: "key",
    chosen: { model: "lab-model", providers: [] },
    request: {
      messages: [{ role: "user", content: "Hello" }],
      ...options.request,
    },
    fetcher,
    stallTimeoutMs: options.stallTimeoutMs ?? 60_000,
  }))
    received.push(event);
  return received;
}

const created = {
  type: "response.created",
  response: { id: "resp_1", model: "lab-model-2026", status: "in_progress" },
};

function completed(
  output: readonly unknown[] = [],
  usage: unknown = {
    input_tokens: 2_000,
    input_tokens_details: { cached_tokens: 1_500, cache_write_tokens: 200 },
    output_tokens: 300,
    output_tokens_details: { reasoning_tokens: 120 },
    total_tokens: 2_300,
  },
) {
  return {
    type: "response.completed",
    response: {
      id: "resp_1",
      model: "lab-model-2026",
      status: "completed",
      output,
      usage,
    },
  };
}

const reasoningDone = {
  id: "rs_1",
  type: "reasoning",
  summary: [
    { type: "summary_text", text: "Reading the note." },
    { type: "summary_text", text: "Answering." },
  ],
  encrypted_content: "sealed-in-full",
  status: "completed",
};
const messageDone = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  status: "completed",
  phase: "final_answer",
  content: [
    { type: "output_text", text: "It says buy milk.", annotations: [] },
  ],
};

const answered = [
  created,
  {
    type: "response.output_item.added",
    output_index: 0,
    item: { ...reasoningDone, summary: [], encrypted_content: "sealed-in" },
  },
  {
    type: "response.reasoning_summary_text.delta",
    item_id: "rs_1",
    output_index: 0,
    summary_index: 0,
    delta: "Reading ",
  },
  {
    type: "response.reasoning_summary_text.delta",
    item_id: "rs_1",
    output_index: 0,
    summary_index: 0,
    delta: "the note.",
  },
  {
    type: "response.reasoning_summary_text.delta",
    item_id: "rs_1",
    output_index: 0,
    summary_index: 1,
    delta: "Answering.",
  },
  { type: "response.output_item.done", output_index: 0, item: reasoningDone },
  {
    type: "response.output_item.added",
    output_index: 1,
    item: { ...messageDone, status: "in_progress", content: [] },
  },
  {
    type: "response.output_text.delta",
    item_id: "msg_1",
    output_index: 1,
    content_index: 0,
    delta: "It says ",
  },
  {
    type: "response.output_text.delta",
    item_id: "msg_1",
    output_index: 1,
    content_index: 0,
    delta: "buy milk.",
  },
  { type: "response.output_item.done", output_index: 1, item: messageDone },
  completed([reasoningDone, messageDone]),
];

describe("a streamed Responses answer", () => {
  it("streams the reasoning summary apart from the words, a new summary part as a new paragraph", async () => {
    const events = await read(streamOf(answered));

    expect(
      events.filter((event) => event.kind !== "usage" && event.kind !== "done"),
    ).toEqual([
      { kind: "reasoningDelta", text: "Reading " },
      { kind: "reasoningDelta", text: "the note." },
      { kind: "reasoningDelta", text: "\n\nAnswering." },
      { kind: "textDelta", text: "It says " },
      { kind: "textDelta", text: "buy milk." },
    ]);
  });

  it("reports usage with cached input counted inside the input, what was written to the cache, and what reasoning spent", async () => {
    const events = await read(streamOf(answered));

    expect(events.filter((event) => event.kind === "usage")).toEqual([
      {
        kind: "usage",
        usage: {
          requestId: "resp_1",
          model: "lab-model-2026",
          inputTokens: 2_000,
          outputTokens: 300,
          totalTokens: 2_300,
          cacheReadTokens: 1_500,
          cacheWriteTokens: 200,
          reasoningTokens: 120,
        },
      },
    ]);
  });

  it("ends with the response's id and model, as complete, and the finished output items as this provider's replay record", async () => {
    const events = await read(streamOf(answered));

    expect(events.at(-1)).toEqual({
      kind: "done",
      finishReason: "completed",
      response: {
        requestId: "resp_1",
        model: "lab-model-2026",
        finishReason: "completed",
        termination: "finishReason",
        complete: true,
      },
      replay: {
        provider: "lab",
        format: "responses",
        data: { output: [reasoningDone, messageDone] },
      },
    });
  });

  it("assembles each function call from its item and its argument fragments, indexed by call", async () => {
    const call = (id: string) => ({
      id: `fc_${id}`,
      type: "function_call",
      call_id: `call-${id}`,
      name: "read_note",
      arguments: "",
      status: "in_progress",
    });
    const events = await read(
      streamOf([
        created,
        {
          type: "response.output_item.added",
          output_index: 0,
          item: reasoningDone,
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: reasoningDone,
        },
        {
          type: "response.output_item.added",
          output_index: 1,
          item: call("a"),
        },
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_a",
          output_index: 1,
          delta: '{"title":',
        },
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_a",
          output_index: 1,
          delta: '"todo"}',
        },
        {
          type: "response.output_item.added",
          output_index: 2,
          item: call("b"),
        },
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_b",
          output_index: 2,
          delta: "{}",
        },
        completed(),
      ]),
    );

    expect(events.filter((event) => event.kind === "toolCallDelta")).toEqual([
      { kind: "toolCallDelta", index: 0, callId: "call-a", name: "read_note" },
      { kind: "toolCallDelta", index: 0, argumentsDelta: '{"title":' },
      { kind: "toolCallDelta", index: 0, argumentsDelta: '"todo"}' },
      { kind: "toolCallDelta", index: 1, callId: "call-b", name: "read_note" },
      { kind: "toolCallDelta", index: 1, argumentsDelta: "{}" },
    ]);
    expect(events.at(-1)).toMatchObject({
      kind: "done",
      response: { complete: true },
    });
  });

  it("passes on arguments that arrived only with the finished call", async () => {
    const finished = {
      id: "fc_a",
      type: "function_call",
      call_id: "call-a",
      name: "read_note",
      arguments: '{"title":"todo"}',
      status: "completed",
    };
    const events = await read(
      streamOf([
        created,
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...finished, arguments: "", status: "in_progress" },
        },
        { type: "response.output_item.done", output_index: 0, item: finished },
        completed([finished]),
      ]),
    );

    expect(events.filter((event) => event.kind === "toolCallDelta")).toEqual([
      { kind: "toolCallDelta", index: 0, callId: "call-a", name: "read_note" },
      { kind: "toolCallDelta", index: 0, argumentsDelta: '{"title":"todo"}' },
    ]);
  });

  it("shows a refusal from the model as its answer", async () => {
    const events = await read(
      streamOf([
        created,
        {
          type: "response.refusal.delta",
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          delta: "I can't help with that.",
        },
        completed(),
      ]),
    );

    expect(events.filter((event) => event.kind === "textDelta")).toEqual([
      { kind: "textDelta", text: "I can't help with that." },
    ]);
  });

  it("marks an answer cut off at the output limit as incomplete, with the finish reason `length`", async () => {
    const events = await read(
      streamOf([
        created,
        {
          type: "response.output_text.delta",
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          delta: "It says",
        },
        {
          type: "response.incomplete",
          response: {
            id: "resp_1",
            model: "lab-model-2026",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: [],
            usage: completed().response.usage,
          },
        },
      ]),
    );

    expect(events.at(-1)).toEqual({
      kind: "done",
      finishReason: "length",
      response: {
        requestId: "resp_1",
        model: "lab-model-2026",
        finishReason: "length",
        termination: "finishReason",
        complete: false,
      },
    });
  });

  it("keeps the provider's own reason for any other incomplete answer, and marks it incomplete", async () => {
    const events = await read(
      streamOf([
        created,
        {
          type: "response.incomplete",
          response: {
            id: "resp_1",
            status: "incomplete",
            incomplete_details: { reason: "content_filter" },
          },
        },
      ]),
    );

    expect(events.at(-1)).toMatchObject({
      kind: "done",
      finishReason: "content_filter",
      response: { finishReason: "content_filter", complete: false },
    });
  });

  it("reads nothing after the provider says the response ended", async () => {
    const events = await read(
      streamOf(answered, ["data: [DONE]\n\n", "data: not json\n\n"]),
    );

    expect(events.at(-1)).toMatchObject({ kind: "done" });
  });
});

describe("a Responses request that fails", () => {
  it("is ended by a failed response with the dialect's reading of its code, keeping what arrived before", async () => {
    const reports: FailureReport[] = [];
    const received: ModelEvent[] = [];

    await expect(
      read(
        streamOf([
          created,
          {
            type: "response.output_text.delta",
            item_id: "msg_1",
            output_index: 0,
            content_index: 0,
            delta: "It says",
          },
          {
            type: "response.failed",
            response: {
              id: "resp_1",
              status: "failed",
              error: {
                code: "server_error",
                message: "The model failed to generate a response.",
              },
            },
          },
        ]),
        { dialect: dialectSeeing(reports), received },
      ),
    ).rejects.toMatchObject({ code: "refused" });
    expect(received).toEqual([{ kind: "textDelta", text: "It says" }]);
    expect(reports).toEqual([
      {
        status: 0,
        error: {
          code: "server_error",
          message: "The model failed to generate a response.",
        },
        model: "lab-model",
        inStream: true,
      },
    ]);
  });

  it("is ended by an error event the same way", async () => {
    const reports: FailureReport[] = [];

    await expect(
      read(
        streamOf([
          created,
          {
            type: "error",
            code: "rate_limit_exceeded",
            message: "Slow down.",
            param: null,
            sequence_number: 2,
          },
        ]),
        { dialect: dialectSeeing(reports) },
      ),
    ).rejects.toMatchObject({ code: "refused" });
    expect(reports).toEqual([
      {
        status: 0,
        error: { code: "rate_limit_exceeded", message: "Slow down." },
        model: "lab-model",
        inStream: true,
      },
    ]);
  });

  it("is refused in the status line with the body's error passed to the dialect", async () => {
    const reports: FailureReport[] = [];
    const refusing: ModelFetch = async () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => (name === "retry-after" ? "2" : null) },
      body: (async function* () {
        yield encoder.encode(
          JSON.stringify({
            error: {
              message: "Your organization has no prepaid credits remaining.",
              type: "insufficient_quota",
              param: null,
              code: "credit_balance_exhausted",
            },
          }),
        );
      })(),
    });

    await expect(
      read(refusing, { dialect: dialectSeeing(reports) }),
    ).rejects.toMatchObject({ code: "refused" });
    expect(reports).toMatchObject([
      {
        status: 429,
        model: "lab-model",
        error: {
          code: "credit_balance_exhausted",
          type: "insufficient_quota",
          message: "Your organization has no prepaid credits remaining.",
        },
      },
    ]);
    expect(reports[0]?.headers?.get("retry-after")).toBe("2");
  });

  it("is malformed when the stream ends before the provider says the response ended", async () => {
    await expect(
      read(
        streamOf([
          created,
          {
            type: "response.output_text.delta",
            item_id: "msg_1",
            output_index: 0,
            content_index: 0,
            delta: "It says",
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: "malformedResponse", retryable: true });
  });

  it("is malformed when an event cannot be read", async () => {
    await expect(
      read(streamOf([created], ["data: {not json\n\n"])),
    ).rejects.toMatchObject({ code: "malformedResponse" });
  });

  it("gives up on a stream that goes silent and never closes", async () => {
    const silent: ModelFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: (async function* () {
        yield encoder.encode(`data: ${JSON.stringify(created)}\n\n`);
        await new Promise(() => {
          /* Never resolves: the provider went quiet mid-stream. */
        });
      })(),
    });

    await expect(read(silent, { stallTimeoutMs: 50 })).rejects.toMatchObject({
      code: "networkFailure",
    });
  });

  it("reports a request its caller cancelled as cancelled, not as a failed connection", async () => {
    const cancel = new AbortController();
    const waiting: ModelFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        if (init.signal?.aborted) reject(init.signal.reason);
        init.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });

    const sent = read(waiting, { request: { signal: cancel.signal } });
    cancel.abort();

    await expect(sent).rejects.toBe(cancel.signal.reason);
  });

  it("says the provider could not be reached when the connection fails", async () => {
    await expect(
      read(async () => {
        throw new TypeError("fetch failed");
      }),
    ).rejects.toMatchObject({
      code: "networkFailure",
      message: "Could not reach Test Lab. Check the connection and try again.",
    });
  });
});
