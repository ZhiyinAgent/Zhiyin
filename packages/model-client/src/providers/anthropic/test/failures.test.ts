/**
 * What each Anthropic failure means. Anthropic types its errors (errors page,
 * rate limits page and API credits page, checked 2026-10-09): the type decides,
 * the status where the type is missing, and a few sentences tell apart
 * failures that share a type.
 */

import { describe, expect, it } from "vitest";
import type { ModelFetch } from "../../../model-client.js";
import { anthropicClient, drain, refusing, streamOf } from "./support.js";

async function failure(fetcher: ModelFetch) {
  try {
    await drain(anthropicClient({ fetcher }), {
      messages: [{ role: "user", content: "Hello" }],
    });
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error("The request did not fail.");
}

describe("an Anthropic failure", () => {
  it("reads a prompt that no longer fits, with the size and limit it states, or a request over Anthropic's size limit, as too large", async () => {
    expect(
      await failure(
        refusing(400, {
          type: "invalid_request_error",
          message: "prompt is too long: 1030000 tokens > 1000000 maximum",
        }),
      ),
    ).toMatchObject({
      code: "contextExceeded",
      retryable: false,
      tokens: { sent: 1_030_000, limit: 1_000_000 },
    });
    expect(await failure(refusing(413))).toMatchObject({
      code: "contextExceeded",
      retryable: false,
    });
  });

  it("passes on Anthropic's sentence for any other malformed request, and does not send it again", async () => {
    expect(
      await failure(
        refusing(400, {
          type: "invalid_request_error",
          message:
            "messages.1.content.0: Invalid `signature` in `thinking` block.",
        }),
      ),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message:
        "Anthropic refused the request: messages.1.content.0: Invalid `signature` in `thinking` block.",
      provider: { errorType: "invalid_request_error" },
    });
  });

  it("says the account cannot pay when its balance, billing or a spend limit stops it, and does not send the request again", async () => {
    for (const fetcher of [
      refusing(402, {
        type: "billing_error",
        message: "There is an issue with your billing.",
      }),
      refusing(400, {
        type: "invalid_request_error",
        message:
          "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      }),
      refusing(400, {
        type: "invalid_request_error",
        message:
          "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.",
      }),
      refusing(429, {
        type: "rate_limit_error",
        message:
          "You have reached your API usage limits: your organization has crossed its monthly API usage threshold.",
        details: { error_code: "enforced_spend_limit_reached" },
      }),
    ])
      expect(await failure(fetcher)).toMatchObject({
        code: "outOfCredits",
        retryable: false,
      });
  });

  it("points at the key on the Model page when Anthropic rejects it or does not let it act", async () => {
    expect(
      await failure(
        refusing(401, {
          type: "authentication_error",
          message: "Invalid key.",
        }),
      ),
    ).toMatchObject({
      code: "unauthorized",
      retryable: false,
      message: "Anthropic rejected the API key. Check it on the Model page.",
    });
    expect(
      await failure(
        refusing(403, {
          type: "permission_error",
          message:
            "Your API key does not have permission to use the specified resource.",
        }),
      ),
    ).toMatchObject({ code: "unauthorized", retryable: false });
  });

  it("names the model Anthropic does not know", async () => {
    expect(
      await failure(
        refusing(404, {
          type: "not_found_error",
          message: "The requested resource could not be found.",
        }),
      ),
    ).toMatchObject({
      code: "modelUnavailable",
      retryable: false,
      message:
        "Anthropic does not offer claude-opus-5-5 to this account. Choose another model on the Model page.",
    });
  });

  it("sends the request again after a rate limit, waiting as long as Anthropic asks", async () => {
    expect(
      await failure(
        refusing(
          429,
          {
            type: "rate_limit_error",
            message:
              "Number of request tokens has exceeded your per-minute rate limit.",
          },
          { "retry-after": "3" },
        ),
      ),
    ).toMatchObject({
      code: "rateLimited",
      retryable: true,
      retryAfterMs: 3_000,
    });
  });

  it("sends the request again when Anthropic is overloaded, times out or fails without saying why", async () => {
    expect(
      await failure(
        refusing(529, { type: "overloaded_error", message: "Overloaded" }),
      ),
    ).toMatchObject({
      code: "modelUnavailable",
      retryable: true,
      message: "Anthropic is overloaded right now.",
    });
    expect(
      await failure(
        refusing(504, { type: "timeout_error", message: "Request timed out" }),
      ),
    ).toMatchObject({ code: "modelUnavailable", retryable: true });
    expect(
      await failure(
        refusing(500, { type: "api_error", message: "Internal server error" }),
      ),
    ).toMatchObject({ code: "unexplainedError", retryable: true });
    expect(await failure(refusing(502))).toMatchObject({
      code: "unexplainedError",
      retryable: true,
    });
  });

  it("reads an error inside a 200 stream by its type, as the status line would have", async () => {
    expect(
      await failure(
        streamOf([
          {
            type: "message_start",
            message: { id: "msg_1", model: "claude-opus-5-5", content: [] },
          },
          {
            type: "error",
            error: { type: "overloaded_error", message: "Overloaded" },
          },
        ]),
      ),
    ).toMatchObject({ code: "modelUnavailable", retryable: true });
  });
});
