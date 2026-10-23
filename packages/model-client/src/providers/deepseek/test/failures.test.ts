/**
 * What each DeepSeek failure means. DeepSeek documents its failures by
 * status alone (error codes page, checked 2026-10-09); the body's shape is
 * not documented, so its sentence is passed on where there is one.
 */

import { describe, expect, it } from "vitest";
import { deepSeekClient, drain, refusing } from "./support.js";

async function failure(
  status: number,
  message?: string,
  headers?: Record<string, string>,
) {
  try {
    await drain(
      deepSeekClient({ fetcher: refusing(status, message, headers) }),
      { messages: [{ role: "user", content: "Hello" }] },
    );
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error("The request did not fail.");
}

describe("a DeepSeek failure", () => {
  it("reads a conversation that no longer fits as too large, with its size and the limit", async () => {
    expect(
      await failure(
        400,
        "This model's maximum context length is 1048576 tokens. However, you requested 1100000 tokens.",
      ),
    ).toMatchObject({
      code: "contextExceeded",
      retryable: false,
      tokens: { sent: 1_100_000, limit: 1_048_576 },
    });
  });

  it("passes on DeepSeek's sentence for any other malformed request, and does not send it again", async () => {
    expect(
      await failure(400, "Missing `reasoning_content` field in message 2."),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message:
        "DeepSeek refused the request: Missing `reasoning_content` field in message 2.",
    });
    expect(await failure(422)).toMatchObject({
      code: "requestRejected",
      retryable: false,
    });
  });

  it("points at the key on the Model page when DeepSeek rejects it", async () => {
    expect(await failure(401)).toMatchObject({
      code: "unauthorized",
      retryable: false,
      message: "DeepSeek rejected the API key. Check it on the Model page.",
    });
  });

  it("says the balance ran out, and does not send the request again", async () => {
    expect(await failure(402)).toMatchObject({
      code: "outOfCredits",
      retryable: false,
      message:
        "The DeepSeek account has run out of balance. Top it up at platform.deepseek.com, then try again.",
    });
  });

  it("sends the request again after a rate limit, waiting as long as DeepSeek asks", async () => {
    expect(await failure(429, undefined, { "retry-after": "3" })).toMatchObject(
      { code: "rateLimited", retryable: true, retryAfterMs: 3_000 },
    );
  });

  it("sends the request again when DeepSeek's server fails or is overloaded", async () => {
    expect(await failure(500)).toMatchObject({
      code: "unexplainedError",
      retryable: true,
    });
    expect(await failure(503)).toMatchObject({
      code: "modelUnavailable",
      retryable: true,
      message: "DeepSeek is overloaded right now.",
    });
  });
});
