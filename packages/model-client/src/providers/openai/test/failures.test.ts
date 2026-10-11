/**
 * What each OpenAI failure means. From OpenAI's error codes guide and the
 * Responses streaming reference, checked 2026-10-09: a 429 is a rate limit
 * unless its `error.code` says the account's credits or a spending limit ran
 * out, which sending again does not cure; a failure after the status went
 * out arrives as a failed response or an error event carrying a code.
 */

import { describe, expect, it } from "vitest";
import type { ModelFetch } from "../../../model-client.js";
import { drain, openAiClient, refusing, streamOf } from "./support.js";

async function failureFrom(fetcher: ModelFetch) {
  try {
    await drain(openAiClient({ fetcher }), {
      messages: [{ role: "user", content: "Hello" }],
    });
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error("The request did not fail.");
}

const failure = (
  status: number,
  error?: { message: string; type?: string; code?: string | null },
  headers?: Record<string, string>,
) => failureFrom(refusing(status, error, headers));

/** A response that fails after its status went out as 200. */
const failedInStream = (code: string, message: string) =>
  failureFrom(
    streamOf([
      { type: "response.created", response: { id: "resp_1" } },
      {
        type: "response.failed",
        response: { id: "resp_1", status: "failed", error: { code, message } },
      },
    ]),
  );

describe("an OpenAI failure in the status line", () => {
  it("reads a conversation that no longer fits as too large, with its size and the limit where OpenAI states them", async () => {
    expect(
      await failure(400, {
        message:
          "This model's maximum context length is 1050000 tokens. However, you requested 1100000 tokens.",
      }),
    ).toMatchObject({
      code: "contextExceeded",
      retryable: false,
      tokens: { sent: 1_100_000, limit: 1_050_000 },
    });
  });

  it("passes on OpenAI's sentence for any other refused request, and does not send it again", async () => {
    expect(
      await failure(400, {
        message:
          "Invalid service_tier argument: The requested service tier is not allowed for this project.",
        code: null,
      }),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message:
        "OpenAI refused the request: Invalid service_tier argument: The requested service tier is not allowed for this project.",
    });
  });

  it("points at the key on the Model page when OpenAI rejects it", async () => {
    expect(
      await failure(401, { message: "Incorrect API key provided." }),
    ).toMatchObject({
      code: "unauthorized",
      retryable: false,
      message: "OpenAI rejected the API key. Check it on the Model page.",
    });
  });

  it("says the prepaid credits ran out, and does not send the request again", async () => {
    expect(
      await failure(429, {
        message: "You exceeded your current quota.",
        type: "insufficient_quota",
        code: "credit_balance_exhausted",
      }),
    ).toMatchObject({
      code: "outOfCredits",
      retryable: false,
      message:
        "The OpenAI account has no prepaid credits left. Add credits at platform.openai.com, then try again.",
    });
  });

  it("says which spending or usage limit was reached, and does not send the request again", async () => {
    for (const [code, said] of [
      [
        "organization_spend_limit_exceeded",
        "The OpenAI organization reached its spend limit. Raise it at platform.openai.com, or wait for the monthly reset.",
      ],
      [
        "project_spend_limit_exceeded",
        "The OpenAI project reached its spend limit. Raise it at platform.openai.com, or wait for the monthly reset.",
      ],
      [
        "organization_usage_limit_exceeded",
        "The OpenAI organization reached the usage limit OpenAI set for it. Ask OpenAI for a higher limit at platform.openai.com.",
      ],
    ] as const)
      expect(
        await failure(429, { message: "Limit reached.", code }),
      ).toMatchObject({
        code: "outOfCredits",
        retryable: false,
        message: said,
      });
  });

  it("reads any other quota refusal as out of credits by its type", async () => {
    expect(
      await failure(429, {
        message: "You exceeded your current quota.",
        type: "insufficient_quota",
      }),
    ).toMatchObject({ code: "outOfCredits", retryable: false });
  });

  it("sends the request again after a rate limit, waiting as long as OpenAI asks", async () => {
    expect(
      await failure(
        429,
        { message: "Rate limit reached for requests." },
        { "retry-after": "3" },
      ),
    ).toMatchObject({
      code: "rateLimited",
      retryable: true,
      retryAfterMs: 3_000,
    });
    expect(
      await failure(429, {
        message: "Your request rate increased too quickly.",
        type: "rate_limit_error",
        code: "slow_down",
      }),
    ).toMatchObject({ code: "rateLimited", retryable: true });
  });

  it("sends the request again when OpenAI's server fails or the model is overloaded", async () => {
    expect(await failure(500)).toMatchObject({
      code: "unexplainedError",
      retryable: true,
    });
    expect(
      await failure(
        503,
        {
          message: "The model is overloaded.",
          type: "service_unavailable_error",
          code: "server_is_overloaded",
        },
        { "retry-after": "5" },
      ),
    ).toMatchObject({
      code: "modelUnavailable",
      retryable: true,
      retryAfterMs: 5_000,
      message: "The model is overloaded at OpenAI right now.",
    });
  });
});

describe("an OpenAI failure inside the stream", () => {
  it("sends the request again when the model failed on OpenAI's side or hit a rate limit", async () => {
    expect(
      await failedInStream(
        "server_error",
        "The model failed to generate a response.",
      ),
    ).toMatchObject({ code: "unexplainedError", retryable: true });
    expect(
      await failedInStream("rate_limit_exceeded", "Rate limit exceeded."),
    ).toMatchObject({ code: "rateLimited", retryable: true });
  });

  it("says a picture could not be used, in OpenAI's words", async () => {
    expect(
      await failedInStream(
        "invalid_base64_image",
        "The image data is invalid.",
      ),
    ).toMatchObject({
      code: "attachmentRejected",
      retryable: false,
      message: "OpenAI could not use a picture: The image data is invalid.",
    });
  });

  it("reads a policy block as a refusal, never sent again", async () => {
    for (const code of [
      "bio_policy",
      "misalignment_policy_violation",
      "image_content_policy_violation",
    ])
      expect(
        await failedInStream(code, "The request was blocked."),
      ).toMatchObject({
        code: "refused",
        retryable: false,
        message: "OpenAI declined the request: The request was blocked.",
      });
  });

  it("passes on OpenAI's sentence for any other code, and does not send it again", async () => {
    expect(
      await failedInStream("invalid_prompt", "Invalid prompt."),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message: "OpenAI refused the request: Invalid prompt.",
    });
  });

  it("is read the same way from an error event", async () => {
    expect(
      await failureFrom(
        streamOf([
          {
            type: "error",
            code: "rate_limit_exceeded",
            message: "Rate limit exceeded.",
            param: null,
          },
        ]),
      ),
    ).toMatchObject({ code: "rateLimited", retryable: true });
  });
});
