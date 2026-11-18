/**
 * What each Moonshot failure means. Its error codes page (checked 2026-10-09)
 * gives each failure an `error.type` beside its status, and 429 means three
 * different things told apart only by that type: a rate limit, an overloaded
 * service, and an account that cannot pay.
 */

import { describe, expect, it } from "vitest";
import { drain, moonshotClient, refusing } from "./support.js";

async function failure(
  status: number,
  error?: { type: string; message: string },
  headers?: Record<string, string>,
) {
  try {
    await drain(moonshotClient({ fetcher: refusing(status, error, headers) }), {
      messages: [{ role: "user", content: "Hello" }],
    });
  } catch (caught) {
    return caught as Record<string, unknown>;
  }
  throw new Error("The request did not fail.");
}

describe("a Moonshot failure", () => {
  it("reads input past the model's window as a request too large", async () => {
    expect(
      await failure(400, {
        type: "invalid_request_error",
        message: "Input token length too long",
      }),
    ).toMatchObject({ code: "contextExceeded", retryable: false });
  });

  it("reads input that leaves no room for the reply as a request too large", async () => {
    expect(
      await failure(400, {
        type: "invalid_request_error",
        message: "prompt tokens + max_tokens exceeds the model specification",
      }),
    ).toMatchObject({ code: "contextExceeded", retryable: false });
  });

  it("passes on Moonshot's sentence for any other malformed request, and does not send it again", async () => {
    expect(
      await failure(400, {
        type: "invalid_request_error",
        message:
          "Request format error, missing required parameter, or invalid parameter type",
      }),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message:
        "Kimi refused the request: Request format error, missing required parameter, or invalid parameter type",
    });
  });

  it("says the content check declined the request, in Moonshot's words", async () => {
    expect(
      await failure(400, {
        type: "content_filter",
        message: "The request was rejected because it was considered high risk",
      }),
    ).toMatchObject({
      code: "refused",
      retryable: false,
      message:
        "Kimi declined the request: The request was rejected because it was considered high risk",
    });
  });

  it("points at the key, and at the platform it was made on, when Moonshot rejects it", async () => {
    expect(
      await failure(401, {
        type: "invalid_authentication_error",
        message: "Invalid Authentication",
      }),
    ).toMatchObject({
      code: "unauthorized",
      retryable: false,
      message:
        "Kimi rejected the API key. Check it on the Model page: a key works only on the platform it was made on, platform.kimi.ai for International and platform.kimi.com for Mainland China.",
    });
  });

  it("passes on Moonshot's sentence when the account may not use what was asked", async () => {
    expect(
      await failure(403, {
        type: "permission_denied_error",
        message: "Your IP is not allowed to access this organization",
      }),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message:
        "Kimi refused the request: Your IP is not allowed to access this organization",
    });
  });

  it("names the stored model and points to the Model page when Moonshot does not offer it", async () => {
    expect(
      await failure(404, {
        type: "resource_not_found_error",
        message:
          "Model not found, or this account does not have permission to access the model",
      }),
    ).toMatchObject({
      code: "modelUnavailable",
      retryable: false,
      message:
        'Kimi does not offer the model "kimi-k3" to this account. Choose another on the Model page.',
    });
  });

  it("sends the request again after a rate limit, waiting as long as Moonshot asks", async () => {
    expect(
      await failure(
        429,
        {
          type: "rate_limit_reached_error",
          message: "Organization-level RPM limit reached",
        },
        { "retry-after": "3" },
      ),
    ).toMatchObject({
      code: "rateLimited",
      retryable: true,
      retryAfterMs: 3_000,
    });
  });

  it("says the account takes few requests at once, and that a top-up raises the limit", async () => {
    expect(
      await failure(429, {
        type: "rate_limit_reached_error",
        message:
          "Your account org-0123<ak-abc> request reached max organization concurrency: 1, please try again after 1 seconds",
      }),
    ).toMatchObject({
      code: "rateLimited",
      retryable: true,
      message:
        "This Kimi account takes 1 request at a time, and another was still open. Kimi raises the limit as the account is topped up.",
    });
  });

  it("says the account reached its requests per minute, and that a top-up raises the limit", async () => {
    expect(
      await failure(429, {
        type: "rate_limit_reached_error",
        message: "Organization-level RPM limit reached",
      }),
    ).toMatchObject({
      code: "rateLimited",
      retryable: true,
      message:
        "This Kimi account reached the number of requests it may send in a minute. Kimi raises the limit as the account is topped up.",
    });
  });

  it("sends the request again when Moonshot's service is overloaded, which is not the account's limit", async () => {
    expect(
      await failure(
        429,
        {
          type: "engine_overloaded_error",
          message: "The engine is currently overloaded, please try again later",
        },
        { "retry-after": "2" },
      ),
    ).toMatchObject({
      code: "modelUnavailable",
      retryable: true,
      retryAfterMs: 2_000,
    });
  });

  it("says the account cannot pay, in Moonshot's words, and does not send the request again", async () => {
    expect(
      await failure(429, {
        type: "exceeded_current_quota_error",
        message:
          "Account balance is insufficient or the account has been disabled",
      }),
    ).toMatchObject({
      code: "outOfCredits",
      retryable: false,
      message:
        "The Kimi account cannot pay for this request: Account balance is insufficient or the account has been disabled. Top it up on its platform, then try again.",
    });
  });

  it("reads a 429 without a type as a rate limit", async () => {
    expect(await failure(429)).toMatchObject({
      code: "rateLimited",
      retryable: true,
    });
  });

  it("sends the request again when Moonshot's server fails or is unavailable", async () => {
    expect(
      await failure(500, {
        type: "server_error",
        message: "Internal server error",
      }),
    ).toMatchObject({ code: "unexplainedError", retryable: true });
    expect(
      await failure(503, {
        type: "server_unavailable",
        message: "The service is temporarily unavailable",
      }),
    ).toMatchObject({ code: "modelUnavailable", retryable: true });
  });
});
