/**
 * What each Mistral failure means. From Mistral's error glossary, its first
 * request quickstart and its API reference, checked 2026-10-09: the body
 * carries `message`, `type`, `param` and `code` at the top level, a 422
 * lists what failed validation under `detail`, and a request larger than the
 * model's window is a 400.
 */

import { describe, expect, it } from "vitest";
import { drain, mistralClient, mistralError, refusing } from "./support.js";

async function failure(
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
) {
  try {
    await drain(mistralClient({ fetcher: refusing(status, body, headers) }), {
      messages: [{ role: "user", content: "Hello" }],
    });
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error("The request did not fail.");
}

describe("a Mistral failure", () => {
  it("reads a 400 whose sentence says the context length was passed as too large, with the sizes it states", async () => {
    // Mistral documents the status, not the sentence; this is the phrasing
    // the shared reading recognises.
    expect(
      await failure(
        400,
        mistralError(
          "This model's maximum context length is 1000000 tokens. However, you requested 1100000 tokens.",
        ),
      ),
    ).toMatchObject({
      code: "contextExceeded",
      retryable: false,
      tokens: { sent: 1_100_000, limit: 1_000_000 },
    });
  });

  it("passes on Mistral's sentence for any other malformed request, and does not send it again", async () => {
    expect(
      await failure(400, mistralError("The request was malformed.")),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message: "Mistral refused the request: The request was malformed.",
    });
  });

  it("passes on what failed validation in a 422", async () => {
    expect(
      await failure(422, {
        detail: [
          {
            loc: ["body", "max_tokens"],
            msg: "First problem.",
            type: "example",
          },
          { loc: ["body", "model"], msg: "Second problem.", type: "example" },
        ],
      }),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message: "Mistral refused the request: First problem. Second problem.",
    });
  });

  it("points at the key on the Model page when Mistral rejects it", async () => {
    expect(
      await failure(401, mistralError("Unauthorized", "authentication_error")),
    ).toMatchObject({
      code: "unauthorized",
      retryable: false,
      message: "Mistral rejected the API key. Check it on the Model page.",
    });
  });

  it("says the account cannot pay, and does not send the request again", async () => {
    expect(await failure(402)).toMatchObject({
      code: "outOfCredits",
      retryable: false,
      message:
        "The Mistral account cannot pay for requests. Check its payment method and credits at admin.mistral.ai, then try again.",
    });
  });

  it("names the model when Mistral does not offer it to the account", async () => {
    // The error glossary's own example names the model and `unknown_model`.
    expect(
      await failure(
        400,
        mistralError("The model was not found.", "invalid_request_error", {
          param: "model",
          code: "unknown_model",
        }),
      ),
    ).toMatchObject({
      code: "modelUnavailable",
      retryable: false,
      message:
        'Mistral does not offer "mistral-large-4" to this account: The model was not found.',
    });
    expect(await failure(404)).toMatchObject({
      code: "modelUnavailable",
      retryable: false,
    });
    expect(await failure(403)).toMatchObject({
      code: "modelUnavailable",
      retryable: false,
    });
  });

  it("sends the request again after a rate limit, waiting as long as Mistral asks", async () => {
    expect(
      await failure(
        429,
        mistralError("Too many requests.", "rate_limit_error"),
        { "retry-after": "3" },
      ),
    ).toMatchObject({
      code: "rateLimited",
      retryable: true,
      retryAfterMs: 3_000,
    });
  });

  it("sends the request again when Mistral's servers fail, time out or are overloaded", async () => {
    for (const status of [500, 502, 504])
      expect(await failure(status)).toMatchObject({
        code: "unexplainedError",
        retryable: true,
      });
    expect(await failure(503)).toMatchObject({
      code: "modelUnavailable",
      retryable: true,
      message: "Mistral is overloaded or under maintenance right now.",
    });
  });
});
