import { describe, expect, it } from "vitest";
import {
  ModelClientError,
  OpenRouterModelClient,
  ProviderCredentials,
  type CredentialEntry,
  type ModelEvent,
  type ModelFetch,
} from "../src/index.js";

const apiKey = "test-secret-that-must-not-escape";
const DONE_EVENT = "data: [DONE]\n\n";

function streamResponse(chunks: string[]): Awaited<ReturnType<ModelFetch>> {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      const encoder = new TextEncoder();
      for (const chunk of chunks) yield encoder.encode(chunk);
    })(),
  };
}

async function collect(stream: AsyncIterable<ModelEvent>) {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("OpenRouterModelClient", () => {
  it("sends a picture as a picture, on the channel the provider reads them from", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const fetcher: ModelFetch = async (...args) => {
      requests.push(args);
      return streamResponse([DONE_EVENT]);
    };
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher,
      model: "z-ai/glm-5.3-flash",
    });

    await collect(
      client.send({
        messages: [
          {
            role: "user",
            content: [
              { kind: "text", text: "Here is the page." },
              { kind: "image", mediaType: "image/png", data: "AAAA" },
            ],
          },
        ],
      }),
    );

    expect(JSON.parse(requests[0]?.[1].body ?? "{}")).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Here is the page." },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AAAA" },
            },
          ],
        },
      ],
    });
  });

  it("says whether this model can be shown a picture at all", async () => {
    const seeing = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher: async () => streamResponse([]),
      model: "z-ai/glm-5.3-flash",
      modelInfo: async () => ({
        architecture: { input_modalities: ["text", "image", "video"] },
      }),
    });
    const reading = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher: async () => streamResponse([]),
      model: "z-ai/glm-5.3",
      modelInfo: async () => ({
        architecture: { input_modalities: ["text"] },
      }),
    });

    expect((await seeing.settings()).acceptsImages).toBe(true);
    expect((await reading.settings()).acceptsImages).toBe(false);
  });

  it("streams provider text and authoritative usage without exposing wire fields", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const fetcher: ModelFetch = async (...args) => {
      requests.push(args);
      return streamResponse([
        'data: {"id":"gen-1","model":"z-ai/glm-5.3-flash","choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
        'data: {"id":"gen-1","model":"z-ai/glm-5.3-flash","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15,"cost":0.000004}}\n\n',
        "data: [DONE]\n\n",
      ]);
    };
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher,
      model: "z-ai/glm-5.3-flash",
    });

    const events = await collect(
      client.send({ messages: [{ role: "user", content: "Hello" }] }),
    );

    expect(events).toEqual([
      { kind: "textDelta", text: "Hel" },
      { kind: "textDelta", text: "lo" },
      {
        kind: "usage",
        usage: {
          requestId: "gen-1",
          model: "z-ai/glm-5.3-flash",
          inputTokens: 12,
          outputTokens: 3,
          totalTokens: 15,
          costUsd: 0.000004,
        },
      },
      {
        kind: "done",
        finishReason: "stop",
        response: {
          requestId: "gen-1",
          model: "z-ai/glm-5.3-flash",
          finishReason: "stop",
          termination: "finishReason",
          complete: true,
        },
      },
    ]);
    expect(JSON.parse(requests[0]?.[1].body ?? "{}")).toMatchObject({
      model: "z-ai/glm-5.3-flash",
      stream: true,
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("sends a bounded schema request for auxiliary model work", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse(["data: [DONE]\n\n"]);
      },
      model: "z-ai/glm-5.3-flash",
    });

    await collect(
      client.send({
        messages: [{ role: "user", content: "Describe this action." }],
        maximumOutputTokens: 160,
        reasoningEffort: "none",
        responseFormat: {
          name: "action_presentation",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
            },
            required: ["title", "description"],
            additionalProperties: false,
          },
        },
      }),
    );

    expect(JSON.parse(requests[0]?.[1].body ?? "{}")).toMatchObject({
      model: "z-ai/glm-5.3-flash",
      max_tokens: 160,
      reasoning: { effort: "none" },
      provider: { require_parameters: true },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "action_presentation",
          strict: true,
        },
      },
    });
  });

  /**
   * OpenRouter picks an upstream unless told otherwise, and its upstreams
   * differ in tokenisation, quantisation and quirks — so unrestricted, two
   * identical requests can be answered by two different machines with nothing
   * in the app recording which.
   *
   * The restriction is an allowlist, not a single name. `only` bounds routing
   * to providers we have measured; `order` ranks them within that bound. A
   * one-element list is the failure this replaced: every upstream shares a
   * finite pool, and when the single named provider's pool is exhausted every
   * request fails with nothing to fall back to. Measured 2026-09-07: pinned to
   * one provider, 10 of 10 requests returned HTTP 429; unrestricted, 10 of 10
   * succeeded.
   */
  it("restricts routing to the allowlist and ranks it", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      providers: ["z-ai", "deepinfra"],
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse(["data: [DONE]\n\n"]);
      },
    });

    await collect(client.send({ messages: [{ role: "user", content: "Hi" }] }));

    expect(JSON.parse(requests[0]?.[1].body ?? "{}")).toMatchObject({
      provider: { only: ["z-ai", "deepinfra"], order: ["z-ai", "deepinfra"] },
    });
  });

  /**
   * `allow_fallbacks: false` was doing nothing an allowlist does not already
   * do, and reads as though it forbids the substitution that `only` already
   * bounds. Verified 2026-09-07 against OpenRouter: with a two-element
   * `order` and `allow_fallbacks: false`, a rate-limited first provider was
   * still answered by the second — the flag never prevented recovery inside
   * the list, only outside it.
   */
  it("does not forbid recovery inside the allowlist", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      providers: ["z-ai", "deepinfra"],
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse(["data: [DONE]\n\n"]);
      },
    });

    await collect(client.send({ messages: [{ role: "user", content: "Hi" }] }));

    expect(
      JSON.parse(requests[0]?.[1].body ?? "{}").provider,
    ).not.toHaveProperty("allow_fallbacks");
  });

  /**
   * The allowlist and the structured-output constraint are two facts about
   * routing and both have to survive. They were separate spreads of the same
   * key, so one would have replaced the other outright.
   */
  it("keeps the allowlist on a request that also constrains routing", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      providers: ["z-ai"],
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse(["data: [DONE]\n\n"]);
      },
    });

    await collect(
      client.send({
        messages: [{ role: "user", content: "Return JSON." }],
        jsonMode: true,
      }),
    );

    expect(JSON.parse(requests[0]?.[1].body ?? "{}")).toMatchObject({
      provider: {
        only: ["z-ai"],
        order: ["z-ai"],
        require_parameters: true,
      },
    });
  });

  it("lets OpenRouter choose when the allowlist is empty", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      providers: [],
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse(["data: [DONE]\n\n"]);
      },
    });

    await collect(client.send({ messages: [{ role: "user", content: "Hi" }] }));

    expect(JSON.parse(requests[0]?.[1].body ?? "{}")).not.toHaveProperty(
      "provider",
    );
  });

  /**
   * A rate limit under an allowlist is every allowed provider's pool being
   * exhausted at once, not OpenRouter throttling this account — the two look
   * identical from the status code and lead somewhere different. The message
   * must not send a person to check their own usage for someone else's
   * capacity.
   */
  it("reports a rate limit as exhausted provider capacity", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher: async () => ({
        ok: false,
        status: 429,
        headers: { get: () => null },
        body: null,
      }),
    });

    await expect(
      collect(client.send({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toMatchObject({
      code: "rateLimited",
      message: expect.stringContaining("capacity"),
    });
  });

  /**
   * 404 here is routing having excluded every provider — an allowlist that
   * names nobody serving the model, or a parameter none of them support. It
   * is not the model being down, and saying so sends a person to wait for a
   * recovery that will never come.
   */
  it("reports an empty routing result as no available provider", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher: async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
        body: null,
      }),
    });

    await expect(
      collect(client.send({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toMatchObject({
      code: "modelUnavailable",
      message: expect.stringContaining("provider"),
    });
  });

  /**
   * The stored choice is the thing that has to change, so the failure has to
   * name it. A person who picked a model months ago and comes back to an app
   * that will not answer is being told the truth about routing and nothing at
   * all about what to do; the id they chose, and where they chose it, is the
   * whole of the actionable part.
   */
  it("names the stored model when routing can no longer serve it", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      model: "z-ai/glm-5.3-flash",
      fetcher: async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
        body: null,
      }),
    });

    await expect(
      collect(client.send({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toMatchObject({
      code: "modelUnavailable",
      message: expect.stringContaining("z-ai/glm-5.3-flash"),
    });
  });

  it("points a withdrawn model at the place the choice is made", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      model: "z-ai/glm-5.3-flash",
      fetcher: async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
        body: null,
      }),
    });

    await expect(
      collect(client.send({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toMatchObject({
      code: "modelUnavailable",
      message: expect.stringContaining("Settings"),
    });
  });

  /**
   * Verified against the live provider on 2026-09-13: a model id the provider
   * does not recognise comes back as 400 "... is not a valid model ID", while a
   * model that existed and was retired comes back as 404 "No endpoints found".
   * Both are the same thing to the person - the stored choice is dead - and
   * only one of them was being reported as such. The other was reported as the
   * request being too large, which sends somebody to shorten a message that was
   * never the problem.
   */
  function refusedWith(status: number, message: string) {
    return async () => ({
      ok: false,
      status,
      headers: { get: () => null },
      body: (async function* () {
        yield new TextEncoder().encode(
          JSON.stringify({ error: { message, code: status } }),
        );
      })(),
    });
  }

  it("reports an unrecognised model id as the model, not as an oversized request", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      model: "z-ai/glm-4.9-retired",
      fetcher: refusedWith(400, "z-ai/glm-4.9-retired is not a valid model ID"),
    });

    await expect(
      collect(client.send({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toMatchObject({
      code: "modelUnavailable",
      message: expect.stringContaining("z-ai/glm-4.9-retired"),
    });
  });

  it("still reports a genuinely oversized request as too large", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      model: "z-ai/glm-5.3-flash",
      fetcher: refusedWith(
        400,
        "This endpoint's maximum context length is 131072 tokens",
      ),
    });

    await expect(
      collect(client.send({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toMatchObject({ code: "contextExceeded" });
  });

  /**
   * ADR 0030: routing is unrestricted by default, superseding ADR 0022's
   * allowlist. A compiled-in default naming one model's first-party provider is
   * meaningless for every other model - `z-ai` does not serve
   * `inception/mercury-2.5` - so applied to a model somebody chose it stops
   * being a safety default and silently refuses their choice.
   *
   * Verified live on 2026-09-13 with that default still in place: this client
   * was refused 404 for `inception/mercury-2.5`, while the identical request
   * carrying no provider restriction was served 200.
   */
  it("leaves routing unrestricted when no upstreams were chosen", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      model: "inception/mercury-2.5",
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse([DONE_EVENT]);
      },
    });

    await collect(client.send({ messages: [{ role: "user", content: "Hi" }] }));

    expect(JSON.parse(requests[0]?.[1].body ?? "{}").provider).toBeUndefined();
  });

  it("requests JSON without claiming schema enforcement", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse(["data: [DONE]\n\n"]);
      },
      model: "z-ai/glm-5.3-flash",
    });

    await collect(
      client.send({
        messages: [{ role: "user", content: "Return JSON." }],
        maximumOutputTokens: 160,
        reasoningEffort: "none",
        jsonMode: true,
      }),
    );

    expect(JSON.parse(requests[0]?.[1].body ?? "{}")).toMatchObject({
      model: "z-ai/glm-5.3-flash",
      max_tokens: 160,
      reasoning: { effort: "none" },
      provider: { require_parameters: true },
      response_format: { type: "json_object" },
    });
  });

  it("preserves assistant tool calls and pairs tool results on continuation", async () => {
    const requests: Parameters<ModelFetch>[] = [];
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher: async (...args) => {
        requests.push(args);
        return streamResponse(["data: [DONE]\n\n"]);
      },
    });

    await collect(
      client.send({
        messages: [
          { role: "user", content: "Read the project notes" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "call-1",
                name: "read_file",
                arguments: '{"path":"README.md"}',
              },
            ],
          },
          {
            role: "tool",
            toolCallId: "call-1",
            name: "read_file",
            content: JSON.stringify({ ok: true, value: { text: "Hello" } }),
          },
        ],
      }),
    );

    expect(JSON.parse(requests[0]?.[1].body ?? "{}").messages).toEqual([
      { role: "user", content: "Read the project notes" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "read_file",
              arguments: '{"path":"README.md"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-1",
        name: "read_file",
        content: '{"ok":true,"value":{"text":"Hello"}}',
      },
    ]);
  });

  it("treats a stream without its completion marker as malformed", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher: async () =>
        streamResponse([
          'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
        ]),
    });

    await expect(
      collect(client.send({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toMatchObject({ code: "malformedResponse" });
  });

  /**
   * A stream that stops arriving without ever closing is the worst failure the
   * provider has, because nothing about it looks like a failure: the request
   * is open, no error is thrown, and a task waits on it for as long as the app
   * is left running. Only silence between chunks distinguishes it from a model
   * that is thinking, so silence past a bound is what ends it.
   */
  it("gives up on a stream that stops arriving and never closes", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      stallTimeoutMs: 50,
      fetcher: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: (async function* () {
          yield new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"thinking"}}]}\n\n',
          );
          await new Promise(() => {
            /* Never resolves: the provider went quiet mid-stream. */
          });
        })(),
      }),
    });

    await expect(
      collect(client.send({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toMatchObject({ code: "networkFailure" });
  });

  it("does not give up on a slow stream that is still arriving", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      stallTimeoutMs: 120,
      fetcher: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: (async function* () {
          const encoder = new TextEncoder();
          for (const piece of ["one", "two", "three"]) {
            await new Promise((resolve) => setTimeout(resolve, 60));
            yield encoder.encode(
              `data: {"choices":[{"delta":{"content":"${piece}"}}]}\n\n`,
            );
          }
          yield encoder.encode("data: [DONE]\n\n");
        })(),
      }),
    });

    const events = await collect(
      client.send({ messages: [{ role: "user", content: "Hi" }] }),
    );

    expect(events).toEqual([
      { kind: "textDelta", text: "one" },
      { kind: "textDelta", text: "two" },
      { kind: "textDelta", text: "three" },
      {
        kind: "done",
        response: {
          finishReason: null,
          termination: "sentinel",
          complete: true,
        },
      },
    ]);
  });

  it("returns actionable authentication failures without leaking the key", async () => {
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher: async () => ({
        ok: false,
        status: 401,
        headers: { get: () => null },
        body: null,
      }),
    });

    let caught: unknown;
    try {
      await collect(
        client.send({ messages: [{ role: "user", content: "Hi" }] }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ModelClientError);
    expect(caught).toMatchObject({
      code: "unauthorized",
      message: "OpenRouter rejected the API key.",
    });
    expect(JSON.stringify(caught)).not.toContain(apiKey);
  });

  it("reports a missing key before making a network request", async () => {
    let requested = false;
    const client = new OpenRouterModelClient({
      apiKey: async () => undefined,
      fetcher: async () => {
        requested = true;
        return streamResponse(["data: [DONE]\n\n"]);
      },
    });

    await expect(
      collect(client.send({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toMatchObject({ code: "missingCredential" });
    expect(requested).toBe(false);
  });
});

describe("ProviderCredentials", () => {
  function fakeEntry(initial?: string) {
    let password = initial;
    const entry: CredentialEntry = {
      getPassword: async () => password,
      setPassword: async (value) => {
        password = value;
      },
      deletePassword: async () => {
        const existed = password !== undefined;
        password = undefined;
        return existed;
      },
    };
    return entry;
  }

  it("makes the environment override visible without returning its value", async () => {
    const credentials = new ProviderCredentials({
      environment: () => apiKey,
      entry: fakeEntry("stored-key"),
    });

    expect(await credentials.get()).toBe(apiKey);
    const status = await credentials.status();
    expect(status).toEqual({ status: "configured", source: "environment" });
    expect(JSON.stringify(status)).not.toContain(apiKey);
  });

  it("stores and clears a write-only key through the credential entry", async () => {
    const credentials = new ProviderCredentials({
      environment: () => undefined,
      entry: fakeEntry(),
    });

    await expect(credentials.status()).resolves.toEqual({
      status: "missing",
      source: "none",
    });
    await credentials.set(apiKey);
    const status = await credentials.status();
    expect(status).toEqual({
      status: "configured",
      source: "credentialStore",
    });
    expect(JSON.stringify(status)).not.toContain(apiKey);
    await credentials.clear();
    await expect(credentials.status()).resolves.toEqual({
      status: "missing",
      source: "none",
    });
  });

  it("turns a locked credential store into an actionable status", async () => {
    const credentials = new ProviderCredentials({
      environment: () => undefined,
      entry: {
        ...fakeEntry(),
        getPassword: async () => {
          throw new Error("native details");
        },
      },
    });

    await expect(credentials.status()).resolves.toEqual({
      status: "unavailable",
      source: "credentialStore",
      reason: "Secure key storage is unavailable.",
    });
  });

  it("keeps an answer the provider finished but did not sign off", async () => {
    // What actually happened: the model streamed its answer, the final chunk
    // carried finish_reason and usage, and the connection closed before the
    // [DONE] sentinel. Discarding that throws away a completed turn.
    const fetcher: ModelFetch = async () =>
      streamResponse([
        'data: {"id":"gen-1","model":"m","choices":[{"delta":{"content":"done"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
      ]);
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher,
      model: "m",
    });

    const events = await collect(
      client.send({ messages: [{ role: "user", content: "Hi" }] }),
    );

    expect(events.at(-1)).toEqual({
      kind: "done",
      finishReason: "stop",
      response: {
        requestId: "gen-1",
        model: "m",
        finishReason: "stop",
        termination: "finishReason",
        complete: true,
      },
    });
    expect(events).toContainEqual({ kind: "textDelta", text: "done" });
  });

  it("says when an answer stopped because it ran out of room", async () => {
    const fetcher: ModelFetch = async () =>
      streamResponse([
        'data: {"id":"gen-1","model":"m","choices":[{"delta":{"content":"<html"},"finish_reason":null}]}\n\n',
        'data: {"id":"gen-1","model":"m","choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher,
      model: "m",
    });

    const events = await collect(
      client.send({ messages: [{ role: "user", content: "Hi" }] }),
    );

    // Previously this was indistinguishable from a complete answer.
    expect(events.at(-1)).toEqual({
      kind: "done",
      finishReason: "length",
      response: {
        requestId: "gen-1",
        model: "m",
        finishReason: "length",
        termination: "finishReason",
        complete: false,
      },
    });
  });

  it("does not mistake terminal accounting for a completed response", async () => {
    const fetcher: ModelFetch = async () =>
      streamResponse([
        'data: {"id":"gen-incomplete","model":"z-ai/glm-5.3-flash-20260826","provider":"Z.AI","choices":[{"delta":{"reasoning":"I will write the file now."},"finish_reason":null}]}\n\n',
        'data: {"id":"gen-incomplete","model":"z-ai/glm-5.3-flash-20260826","provider":"Z.AI","choices":[],"usage":{"prompt_tokens":41724,"completion_tokens":1478,"total_tokens":43202}}\n\n',
      ]);
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher,
      model: "z-ai/glm-5.3-flash",
    });

    const events = await collect(
      client.send({ messages: [{ role: "user", content: "Go ahead." }] }),
    );

    expect(events.at(-1)).toEqual({
      kind: "done",
      response: {
        requestId: "gen-incomplete",
        model: "z-ai/glm-5.3-flash-20260826",
        provider: "Z.AI",
        finishReason: null,
        termination: "usage",
        complete: false,
      },
    });
  });

  it("keeps a tool call the provider finished but did not sign off", async () => {
    const fetcher: ModelFetch = async () =>
      streamResponse([
        'data: {"id":"gen-1","model":"m","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"write_file","arguments":"{\\"path\\":\\"a\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      ]);
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher,
      model: "m",
    });

    const events = await collect(
      client.send({ messages: [{ role: "user", content: "Hi" }] }),
    );

    expect(events).toContainEqual({
      kind: "toolCallDelta",
      index: 0,
      callId: "call-1",
      name: "write_file",
      argumentsDelta: '{"path":"a"}',
    });
    expect(events.at(-1)).toEqual({
      kind: "done",
      finishReason: "tool_calls",
      response: {
        requestId: "gen-1",
        model: "m",
        finishReason: "tool_calls",
        termination: "finishReason",
        complete: true,
      },
    });
  });

  it("still refuses a stream that ended with nothing to show for it", async () => {
    const fetcher: ModelFetch = async () =>
      streamResponse([
        'data: {"id":"gen-1","model":"m","choices":[{"delta":{"content":"half"},"finish_reason":null}]}\n\n',
      ]);
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher,
      model: "m",
    });

    await expect(
      collect(client.send({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toThrow("ended the response before completion");
  });
});

/**
 * The provider commits HTTP 200 with its headers, so anything that fails after
 * that point - a rate limit, an upstream outage, a moderation refusal - cannot
 * be reported in the status. It arrives as a chunk carrying an `error` object
 * and `finish_reason: "error"`, which is documented behaviour and not an edge
 * case: it is what an ordinary provider failure looks like once tokens have
 * started flowing.
 */
describe("an error delivered inside a 200 stream", () => {
  const errorChunk = (message: string, code = 429) =>
    `data: ${JSON.stringify({
      id: "gen-failed",
      object: "chat.completion.chunk",
      model: "z-ai/glm-5.3-flash",
      provider: "Z.AI",
      error: { code, message, metadata: { error_type: "rate_limited" } },
      choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
    })}\n\n`;

  function clientOver(chunks: string[]) {
    return new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher: async () => streamResponse(chunks),
      model: "z-ai/glm-5.3-flash",
    });
  }

  it("fails the request rather than reporting a completed answer", async () => {
    const client = clientOver([
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta: { content: "The three largest are" } }],
      })}\n\n`,
      errorChunk("Provider returned error"),
    ]);

    await expect(collect(client.send({ messages: [] }))).rejects.toBeInstanceOf(
      ModelClientError,
    );
  });

  it("says what the provider said went wrong", async () => {
    const client = clientOver([errorChunk("Rate limit exceeded for Z.AI")]);

    await expect(collect(client.send({ messages: [] }))).rejects.toThrow(
      /Rate limit exceeded for Z\.AI/,
    );
  });

  it("keeps the text that did arrive before the failure", async () => {
    const seen: ModelEvent[] = [];
    const client = clientOver([
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta: { content: "Partial answer" } }],
      })}\n\n`,
      errorChunk("Provider returned error"),
    ]);

    await expect(
      (async () => {
        for await (const event of client.send({ messages: [] }))
          seen.push(event);
      })(),
    ).rejects.toBeInstanceOf(ModelClientError);
    expect(seen).toContainEqual({ kind: "textDelta", text: "Partial answer" });
    expect(seen.some((event) => event.kind === "done")).toBe(false);
  });

  it("does not mistake an ordinary finish reason of its own for a failure", async () => {
    const client = clientOver([
      `data: ${JSON.stringify({
        choices: [
          { index: 0, delta: { content: "All done" }, finish_reason: "stop" },
        ],
      })}\n\n`,
      DONE_EVENT,
    ]);

    const events = await collect(client.send({ messages: [] }));

    expect(events.at(-1)).toMatchObject({
      kind: "done",
      response: { complete: true, finishReason: "stop" },
    });
  });
});
