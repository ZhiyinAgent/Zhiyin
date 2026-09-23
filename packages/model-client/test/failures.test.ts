import { describe, expect, it } from "vitest";
import {
  OpenRouterModelClient,
  type ModelEvent,
  type ModelFetch,
} from "../src/index.js";

/**
 * OpenRouter tags a failure with a typed `error_type` (errors reference,
 * https://openrouter.ai/docs/api-reference/errors, read 2026-09-23). The HTTP
 * status alone cannot tell a context overflow from a bad tool schema - both are
 * 400 - or a moderation block from a rejected key - both are 403. Reading the
 * status alone told people to shorten conversations and replace working keys.
 */

const apiKey = "test-secret-that-must-not-escape";
/**
 * A retryable failure is sent again (ADR 0049). These tests are about what one
 * failure is reported as, so the retries happen without waiting and the same
 * failure comes out at the end.
 */
const noWaiting = { wait: async () => {} };

type Refusal = {
  readonly status: number;
  readonly message?: string;
  readonly metadata?: Record<string, unknown>;
  readonly retryAfter?: string;
};

function refusing(refusal: Refusal): ModelFetch {
  return async () => ({
    ok: false,
    status: refusal.status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "retry-after"
          ? (refusal.retryAfter ?? null)
          : null,
    },
    body: (async function* () {
      yield new TextEncoder().encode(
        JSON.stringify({
          error: {
            code: refusal.status,
            ...(refusal.message === undefined
              ? {}
              : { message: refusal.message }),
            ...(refusal.metadata ? { metadata: refusal.metadata } : {}),
          },
        }),
      );
    })(),
  });
}

function streamingThen(error: Record<string, unknown>): ModelFetch {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      yield new TextEncoder().encode(
        `data: ${JSON.stringify({
          id: "gen-failed",
          object: "chat.completion.chunk",
          error,
          choices: [
            { index: 0, delta: { content: "" }, finish_reason: "error" },
          ],
        })}\n\n`,
      );
    })(),
  });
}

async function failureOf(fetcher: ModelFetch): Promise<unknown> {
  const client = new OpenRouterModelClient({
    retry: noWaiting,
    apiKey: async () => apiKey,
    fetcher,
    model: "z-ai/glm-5.3-flash",
  });
  try {
    const events: ModelEvent[] = [];
    for await (const event of client.send({
      messages: [{ role: "user", content: "Hi" }],
    }))
      events.push(event);
  } catch (error) {
    return error;
  }
  throw new Error("The request was expected to fail.");
}

describe("a refused request is reported for what it is", () => {
  it("tells a bad tool schema, a bad parameter, a bad picture and an oversized request apart", async () => {
    const schema = await failureOf(
      refusing({
        status: 400,
        message: "Invalid schema for function 'write_file': 'type' is required",
        metadata: { error_type: "invalid_request" },
      }),
    );
    const parameter = await failureOf(
      refusing({
        status: 400,
        message:
          "Unsupported parameter: 'top_k' is not supported with this model.",
      }),
    );
    const picture = await failureOf(
      refusing({
        status: 400,
        message: "Image exceeds 5 MB maximum",
        metadata: { error_type: "image_too_large" },
      }),
    );
    const oversized = await failureOf(
      refusing({
        status: 400,
        message: "Prompt is too long",
        metadata: { error_type: "context_length_exceeded" },
      }),
    );

    expect(schema).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message: expect.stringContaining("Invalid schema for function"),
    });
    expect(parameter).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message: expect.stringContaining("Unsupported parameter"),
    });
    expect(picture).toMatchObject({
      code: "attachmentRejected",
      retryable: false,
      message: expect.stringContaining("Image exceeds 5 MB maximum"),
    });
    expect(oversized).toMatchObject({
      code: "contextExceeded",
      retryable: false,
    });
  });

  it("never reports an unexplained 400 as too large", async () => {
    await expect(
      failureOf(refusing({ status: 400, message: "Bad request" })),
    ).resolves.toMatchObject({ code: "requestRejected" });
    await expect(failureOf(refusing({ status: 400 }))).resolves.toMatchObject({
      code: "requestRejected",
    });
  });

  it("does not mistake a spending cap or an output limit for a full conversation", async () => {
    await expect(
      failureOf(
        refusing({
          status: 400,
          message: "Key limit exceeded",
          metadata: { error_type: "token_limit_exceeded" },
        }),
      ),
    ).resolves.toMatchObject({ code: "outOfCredits", retryable: false });
    await expect(
      failureOf(
        refusing({
          status: 400,
          message: "max_tokens reached",
          metadata: { error_type: "max_tokens_exceeded" },
        }),
      ),
    ).resolves.toMatchObject({ code: "requestRejected", retryable: false });
  });

  it("says how large the request was and what the limit is, when the provider does", async () => {
    await expect(
      failureOf(
        refusing({
          status: 400,
          message:
            "This endpoint's maximum context length is 131072 tokens. However, you requested about 150211 tokens (148000 of text input, 2211 in the output). Please reduce the length of either one.",
        }),
      ),
    ).resolves.toMatchObject({
      code: "contextExceeded",
      tokens: { limit: 131072, sent: 150211 },
    });
  });

  it("reports a moderation block as a refusal with its reasons, not as a rejected key", async () => {
    const error = await failureOf(
      refusing({
        status: 403,
        message: "Input was flagged",
        metadata: {
          error_type: "content_policy_violation",
          reasons: ["violence"],
          flagged_input: "something the person wrote",
          provider_name: "Z.AI",
          model_slug: "z-ai/glm-5.3-flash",
        },
      }),
    );

    expect(error).toMatchObject({
      code: "refused",
      retryable: false,
      message: expect.stringContaining("violence"),
    });
    expect((error as Error).message).not.toMatch(/API key/);
  });

  it("keeps who declined and why, but not the person's flagged words", async () => {
    const error = await failureOf(
      refusing({
        status: 403,
        message: "Input was flagged",
        metadata: {
          error_type: "content_policy_violation",
          provider_code: "SAFETY",
          reasons: ["violence"],
          flagged_input: "something the person wrote",
          provider_name: "Z.AI",
          raw: { anything: "at all" },
        },
      }),
    );

    expect(error).toMatchObject({
      provider: {
        errorType: "content_policy_violation",
        code: "SAFETY",
        name: "Z.AI",
        reasons: ["violence"],
      },
    });
    expect(JSON.stringify(error)).not.toContain("something the person wrote");
    expect(JSON.stringify(error)).not.toContain("anything");
  });

  it("reports a 403 that does not name the key as a refusal", async () => {
    await expect(
      failureOf(refusing({ status: 403, message: "Blocked by guardrail" })),
    ).resolves.toMatchObject({ code: "refused" });
    await expect(
      failureOf(refusing({ status: 403, message: "Invalid API key" })),
    ).resolves.toMatchObject({ code: "unauthorized" });
  });

  it("reports running out of credits as that, retryable only when the provider says when", async () => {
    await expect(
      failureOf(refusing({ status: 402, message: "Insufficient credits" })),
    ).resolves.toMatchObject({
      code: "outOfCredits",
      retryable: false,
      message: expect.stringContaining("credits"),
    });
    await expect(
      failureOf(
        refusing({
          status: 402,
          message: "In-flight budget exceeded",
          retryAfter: "3",
        }),
      ),
    ).resolves.toMatchObject({
      code: "outOfCredits",
      retryable: true,
      retryAfterMs: 3_000,
    });
  });

  it("marks a busy model retryable and a withdrawn one permanent", async () => {
    await expect(failureOf(refusing({ status: 503 }))).resolves.toMatchObject({
      code: "modelUnavailable",
      retryable: true,
    });
    await expect(failureOf(refusing({ status: 404 }))).resolves.toMatchObject({
      code: "modelUnavailable",
      retryable: false,
    });
    await expect(
      failureOf(
        refusing({
          status: 503,
          metadata: { error_type: "provider_overloaded" },
        }),
      ),
    ).resolves.toMatchObject({ code: "modelUnavailable", retryable: true });
  });

  it("treats gateway failures and timeouts as passing trouble", async () => {
    for (const status of [408, 500, 502, 504]) {
      await expect(failureOf(refusing({ status }))).resolves.toMatchObject({
        code: "networkFailure",
        retryable: true,
      });
    }
  });

  it("uses its own wording where the provider masked its message", async () => {
    await expect(
      failureOf(
        refusing({
          status: 500,
          message: "Internal Server Error",
          metadata: { error_type: "server" },
        }),
      ),
    ).resolves.toMatchObject({
      code: "networkFailure",
      retryable: true,
      message: expect.not.stringContaining("Internal Server Error"),
    });
  });

  it("falls back to the status for a type it does not know", async () => {
    await expect(
      failureOf(
        refusing({
          status: 429,
          metadata: { error_type: "something_added_next_year" },
        }),
      ),
    ).resolves.toMatchObject({ code: "rateLimited", retryable: true });
    await expect(
      failureOf(
        refusing({
          status: 400,
          message: "Prompt is too long",
          metadata: { error_type: "unmapped" },
        }),
      ),
    ).resolves.toMatchObject({ code: "contextExceeded" });
  });

  it("still names a model id the provider does not recognise, whatever type it carries", async () => {
    await expect(
      failureOf(
        refusing({
          status: 400,
          message: "z-ai/glm-5.3-flash is not a valid model ID",
          metadata: { error_type: "invalid_request" },
        }),
      ),
    ).resolves.toMatchObject({
      code: "modelUnavailable",
      retryable: false,
      message: expect.stringContaining("z-ai/glm-5.3-flash"),
    });
  });
});

describe("a failure inside the stream is classified the same way", () => {
  it("reads a typed rate limit from a mid-stream chunk as retryable", async () => {
    await expect(
      failureOf(
        streamingThen({
          code: 429,
          message: "Rate limit exceeded",
          metadata: { error_type: "rate_limit_exceeded" },
        }),
      ),
    ).resolves.toMatchObject({ code: "rateLimited", retryable: true });
  });

  it("does not mark a mid-stream content-policy stop as retryable", async () => {
    await expect(
      failureOf(
        streamingThen({
          code: 403,
          message: "Output was flagged",
          metadata: { error_type: "content_policy_violation" },
        }),
      ),
    ).resolves.toMatchObject({ code: "refused", retryable: false });
  });

  it("marks an upstream that dropped the stream as retryable", async () => {
    await expect(
      failureOf(
        streamingThen({
          code: 502,
          message: "Provider disconnected mid-stream",
          metadata: { error_type: "provider_unavailable" },
        }),
      ),
    ).resolves.toMatchObject({ code: "networkFailure", retryable: true });
  });
});
