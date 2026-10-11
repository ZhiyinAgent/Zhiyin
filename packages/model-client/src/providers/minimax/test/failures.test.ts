/**
 * What each MiniMax failure means. MiniMax's Anthropic-compatible API types
 * its errors as Anthropic does, `{type: "error", error: {type, message}}`
 * (API reference, checked 2026-10-09); an empty balance has no documented
 * type there, only the native API's code 1008, "insufficient balance".
 */

import { describe, expect, it } from "vitest";
import { drain, miniMaxClient, refusing } from "./support.js";

async function failure(
  status: number,
  error?: { type: string; message: string },
  headers?: Record<string, string>,
) {
  try {
    await drain(miniMaxClient({ fetcher: refusing(status, error, headers) }), {
      messages: [{ role: "user", content: "Hello" }],
    });
  } catch (caught) {
    return caught as Record<string, unknown>;
  }
  throw new Error("The request did not fail.");
}

describe("a MiniMax failure", () => {
  it("reads a conversation that no longer fits as too large", async () => {
    expect(
      await failure(400, {
        type: "invalid_request_error",
        message:
          "This model's maximum context length is 1000000 tokens. However, you requested 1100000 tokens.",
      }),
    ).toMatchObject({
      code: "contextExceeded",
      retryable: false,
      tokens: { sent: 1_100_000, limit: 1_000_000 },
    });
    expect(
      await failure(413, {
        type: "request_too_large",
        message:
          "Request body exceeds 64 MB, or a multimodal file exceeds the size limit.",
      }),
    ).toMatchObject({ code: "contextExceeded", retryable: false });
  });

  it("passes on MiniMax's sentence for any other malformed request", async () => {
    expect(
      await failure(400, {
        type: "invalid_request_error",
        message: "messages.0.content.1: unsupported content type 'foo'",
      }),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message:
        "MiniMax refused the request: messages.0.content.1: unsupported content type 'foo'",
    });
  });

  it("says the account has run out of balance when MiniMax says so", async () => {
    expect(
      await failure(400, {
        type: "invalid_request_error",
        message: "insufficient balance (1008)",
      }),
    ).toMatchObject({ code: "outOfCredits", retryable: false });
  });

  it("points at the key on the Model page when MiniMax rejects it", async () => {
    expect(
      await failure(401, {
        type: "authentication_error",
        message: "API key missing or invalid.",
      }),
    ).toMatchObject({
      code: "unauthorized",
      retryable: false,
      message: "MiniMax rejected the API key. Check it on the Model page.",
    });
  });

  it("names a model MiniMax does not have, or does not let the key use", async () => {
    expect(
      await failure(404, {
        type: "not_found_error",
        message: "Model does not exist.",
      }),
    ).toMatchObject({ code: "modelUnavailable", retryable: false });
    expect(
      await failure(403, {
        type: "permission_error",
        message: "No permission to access this model or path.",
      }),
    ).toMatchObject({ code: "modelUnavailable", retryable: false });
  });

  it("sends the request again after a rate limit, waiting as long as MiniMax asks", async () => {
    expect(
      await failure(
        429,
        {
          type: "rate_limit_error",
          message:
            "RPM / TPM / connection-count or other rate limit triggered.",
        },
        { "retry-after": "3" },
      ),
    ).toMatchObject({
      code: "rateLimited",
      retryable: true,
      retryAfterMs: 3_000,
    });
  });

  it("sends the request again when MiniMax is overloaded or its server fails", async () => {
    expect(
      await failure(529, {
        type: "overloaded_error",
        message: "Upstream model overloaded; retryable.",
      }),
    ).toMatchObject({ code: "modelUnavailable", retryable: true });
    expect(
      await failure(500, {
        type: "api_error",
        message: "Internal server error.",
      }),
    ).toMatchObject({ code: "unexplainedError", retryable: true });
  });
});
