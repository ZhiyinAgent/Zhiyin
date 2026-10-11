/**
 * What each Qwen failure means. QwenCloud's error reference (checked
 * 2026-10-09) names each failure by status and code, in `{error: {message,
 * type, param, code}}`; the same status can mean different things, so the
 * code and Qwen's sentence decide where they differ.
 */

import { describe, expect, it } from "vitest";
import { drain, qwenClient, refusing } from "./support.js";

async function failure(
  status: number,
  error?: { readonly message?: string; readonly code?: string },
  headers?: Record<string, string>,
) {
  try {
    await drain(qwenClient({ fetcher: refusing(status, error, headers) }), {
      messages: [{ role: "user", content: "Hello" }],
    });
  } catch (caught) {
    return caught as Record<string, unknown>;
  }
  throw new Error("The request did not fail.");
}

describe("a Qwen failure", () => {
  it("reads an input longer than the model takes as too large, with the limit Qwen names", async () => {
    expect(
      await failure(400, {
        message: "Range of input length should be [1, 991000]",
        code: "InvalidParameter",
      }),
    ).toMatchObject({
      code: "contextExceeded",
      retryable: false,
      tokens: { limit: 991_000 },
    });
  });

  it("passes on Qwen's sentence for any other malformed request, and does not send it again", async () => {
    expect(
      await failure(400, {
        message:
          'Messages with role "tool" must be a response to a preceding message with "tool_calls"',
        code: "InvalidParameter",
      }),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message:
        'Qwen refused the request: Messages with role "tool" must be a response to a preceding message with "tool_calls"',
    });
  });

  it("says the account owes money when Qwen refuses it for an unpaid balance", async () => {
    expect(
      await failure(400, {
        message: "Access denied, make sure your account is in good standing.",
        code: "Arrearage",
      }),
    ).toMatchObject({ code: "outOfCredits", retryable: false });
  });

  it("reads Qwen's content check as a refusal", async () => {
    expect(
      await failure(400, {
        message: "Input data may contain inappropriate content.",
        code: "data_inspection_failed",
      }),
    ).toMatchObject({ code: "refused", retryable: false });
  });

  it("points at the key on the Model page when Qwen rejects it", async () => {
    expect(
      await failure(401, {
        message: "Incorrect API key provided.",
        code: "invalid_api_key",
      }),
    ).toMatchObject({
      code: "unauthorized",
      retryable: false,
      message: "Qwen rejected the API key. Check it on the Model page.",
    });
  });

  it("says the free quota ran out when Qwen allows only free use", async () => {
    expect(
      await failure(403, {
        message: "The free tier of the model has been exhausted.",
        code: "AllocationQuota.FreeTierOnly",
      }),
    ).toMatchObject({ code: "outOfCredits", retryable: false });
  });

  it("names a model Qwen does not have, and does not try it again", async () => {
    expect(
      await failure(404, {
        message: "The model `qwen-x` does not exist.",
        code: "model_not_found",
      }),
    ).toMatchObject({ code: "modelUnavailable", retryable: false });
  });

  it("waits and tries again when Qwen limits how fast requests or tokens are sent", async () => {
    expect(
      await failure(
        429,
        { message: "Requests rate limit exceeded.", code: "limit_requests" },
        { "retry-after": "3" },
      ),
    ).toMatchObject({
      code: "rateLimited",
      retryable: true,
      retryAfterMs: 3_000,
    });
    // Qwen's `insufficient_quota` is a tokens-per-minute limit, not an empty
    // balance.
    expect(
      await failure(429, {
        message: "Allocated quota exceeded, please increase your quota limit.",
        code: "insufficient_quota",
      }),
    ).toMatchObject({ code: "rateLimited", retryable: true });
  });

  it("says the bill is overdue when Qwen refuses an account for it", async () => {
    expect(
      await failure(429, {
        message: "The postpaid bill is overdue.",
        code: "PostpaidBillOverdue",
      }),
    ).toMatchObject({ code: "outOfCredits", retryable: false });
  });

  it("reads a server failure as unexplained, with Qwen's sentence where it gave one", async () => {
    expect(await failure(500)).toMatchObject({
      code: "unexplainedError",
      message: "Qwen's server failed without saying why.",
    });
    expect(
      await failure(500, {
        message: "An internal error has occured.",
        code: "internal_error",
      }),
    ).toMatchObject({
      code: "unexplainedError",
      message: "Qwen's server failed: An internal error has occured.",
    });
  });
});
