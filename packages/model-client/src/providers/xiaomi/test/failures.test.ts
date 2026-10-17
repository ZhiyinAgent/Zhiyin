/**
 * What each Xiaomi MiMo failure means. Xiaomi documents its failures by
 * status and cause (error codes page, checked 2026-10-09), without the body's
 * shape or wording, so the status decides and Xiaomi's sentence is passed on
 * where there is one.
 */

import { describe, expect, it } from "vitest";
import { drain, refusing, xiaomiClient } from "./support.js";

/** A message with a picture in it, as an attached one is sent. */
const withPicture = [
  {
    role: "user" as const,
    content: [
      { kind: "text" as const, text: "What is this?" },
      { kind: "image" as const, mediaType: "image/png", data: "iVBORw0KGgo=" },
    ],
  },
];

async function failure(
  status: number,
  message?: string,
  headers?: Record<string, string>,
  messages: Parameters<typeof drain>[1]["messages"] = [
    { role: "user", content: "Hello" },
  ],
) {
  try {
    await drain(xiaomiClient({ fetcher: refusing(status, message, headers) }), {
      messages,
    });
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error("The request did not fail.");
}

describe("a Xiaomi MiMo failure", () => {
  it("reads a sentence about the context length as too large, with its size and the limit", async () => {
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

  it("passes on Xiaomi's sentence for any other malformed request, and does not send it again", async () => {
    expect(
      await failure(400, "reasoning_content is missing from message 2."),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message:
        "Xiaomi MiMo refused the request: reasoning_content is missing from message 2.",
    });
    expect(await failure(400)).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message: "Xiaomi MiMo refused the request (HTTP 400).",
    });
  });

  it("points at the key on the Model page when Xiaomi rejects it", async () => {
    expect(await failure(401)).toMatchObject({
      code: "unauthorized",
      retryable: false,
      message: "Xiaomi MiMo rejected the API key. Check it on the Model page.",
    });
  });

  it("says the balance ran out, and does not send the request again", async () => {
    expect(await failure(402)).toMatchObject({
      code: "outOfCredits",
      retryable: false,
      message:
        "The Xiaomi MiMo account has run out of balance. Top it up at platform.xiaomimimo.com, then try again.",
    });
  });

  it("names both causes Xiaomi gives for refusing access, and does not send the request again", async () => {
    expect(await failure(403)).toMatchObject({
      code: "unauthorized",
      retryable: false,
      message:
        "Xiaomi MiMo refused access: its service is not available in this region, or the API key was restricted by its risk control. A new key can be added on the Model page.",
    });
  });

  it("says a picture could not be used when Xiaomi answers that the model takes none", async () => {
    expect(await failure(404, undefined, undefined, withPicture)).toMatchObject(
      {
        code: "attachmentRejected",
        retryable: false,
        message:
          "Xiaomi MiMo says the chosen model or endpoint does not take pictures.",
      },
    );
  });

  it("says the model or endpoint was not found when a request without a picture is answered 404", async () => {
    expect(await failure(404, "Model not found: mimo-v9")).toMatchObject({
      code: "modelUnavailable",
      retryable: false,
      message: expect.stringContaining("Model not found: mimo-v9"),
    });
  });

  it("reports its content filter as a refusal, without repeating what was filtered", async () => {
    expect(
      await failure(421, "The input contains flagged words: example."),
    ).toMatchObject({
      code: "refused",
      retryable: false,
      message: "Xiaomi MiMo's content filter blocked the request.",
    });
  });

  it("sends the request again after a rate limit, waiting as long as Xiaomi asks", async () => {
    expect(await failure(429, undefined, { "retry-after": "3" })).toMatchObject(
      { code: "rateLimited", retryable: true, retryAfterMs: 3_000 },
    );
  });

  it("sends the request again when Xiaomi's server fails or is overloaded", async () => {
    expect(await failure(500)).toMatchObject({
      code: "unexplainedError",
      retryable: true,
    });
    expect(await failure(503)).toMatchObject({
      code: "modelUnavailable",
      retryable: true,
      message: "Xiaomi MiMo is overloaded right now.",
    });
  });
});
