/**
 * What each Z.ai failure means. Both platforms answer a refused request with
 * an HTTP status and a business code in `{error: {code, message}}`; the code
 * says more than the status (error codes pages of Z.ai and BigModel, checked
 * 2026-10-09). Z.ai's own sentence is passed on with every failure.
 */

import { describe, expect, it } from "vitest";
import { untilFailure, refusing, zaiClient } from "./support.js";

async function failure(
  status: number,
  error?: { readonly code: string | number; readonly message: string },
  headers?: Record<string, string>,
) {
  const result = await untilFailure(
    zaiClient({ model: "glm-5.3", fetcher: refusing(status, error, headers) }),
    { messages: [{ role: "user", content: "Hello" }] },
  );
  return result.error;
}

describe("a Z.ai failure", () => {
  it("points at the key on the Model page when Z.ai rejects it, saying why", async () => {
    expect(
      await failure(401, {
        code: "1003",
        message: "Authentication Token expired, please regenerate/obtain",
      }),
    ).toMatchObject({
      code: "unauthorized",
      retryable: false,
      message:
        "Z.ai rejected the API key. Check it on the Model page. (Z.ai: Authentication Token expired, please regenerate/obtain)",
    });
  });

  it("says the balance ran out, and does not send the request again", async () => {
    expect(
      await failure(429, {
        code: "1113",
        message:
          "Insufficient balance or no resource package. Please recharge.",
      }),
    ).toMatchObject({
      code: "outOfCredits",
      retryable: false,
      message:
        "The Z.ai account has run out of balance. Top it up, then try again. (Z.ai: Insufficient balance or no resource package. Please recharge.)",
    });
  });

  it("names the stored model when Z.ai does not know it", async () => {
    expect(
      await failure(400, {
        code: 1211,
        message: "Unknown Model, please check the model code.",
      }),
    ).toMatchObject({
      code: "modelUnavailable",
      retryable: false,
      message: expect.stringContaining('"glm-5.3"'),
    });
  });

  it("reads a prompt that is too long as a conversation that no longer fits", async () => {
    expect(
      await failure(400, { code: "1261", message: "Prompt too long" }),
    ).toMatchObject({ code: "contextExceeded", retryable: false });
  });

  it("reads Z.ai's content filter as a refusal", async () => {
    expect(
      await failure(400, {
        code: "1301",
        message:
          "System detected potentially unsafe or sensitive content in input or generation.",
      }),
    ).toMatchObject({ code: "refused", retryable: false });
  });

  it("sends the request again after a rate limit, waiting as long as Z.ai asks", async () => {
    expect(
      await failure(
        429,
        { code: "1302", message: "Rate limit reached for requests" },
        { "retry-after": "3" },
      ),
    ).toMatchObject({
      code: "rateLimited",
      retryable: true,
      retryAfterMs: 3_000,
    });
  });

  it("sends the request again when the model is overloaded, Z.ai's network fails, or its server fails", async () => {
    expect(
      await failure(429, {
        code: "1305",
        message:
          "The service may be temporarily overloaded, please try again later",
      }),
    ).toMatchObject({ code: "modelUnavailable", retryable: true });
    expect(
      await failure(500, {
        code: "1234",
        message: "Network error, error id: abc, please try again later",
      }),
    ).toMatchObject({ code: "networkFailure", retryable: true });
    expect(await failure(500)).toMatchObject({
      code: "unexplainedError",
      retryable: true,
      message: "Z.ai's server failed without saying why.",
    });
  });

  it("passes on Z.ai's sentence for any other refused request, and does not send it again", async () => {
    expect(
      await failure(400, {
        code: "1214",
        message:
          "Parameter `messages` is invalid. Please check the documentation.",
      }),
    ).toMatchObject({
      code: "requestRejected",
      retryable: false,
      message:
        "Z.ai refused the request. (Z.ai: Parameter `messages` is invalid. Please check the documentation.)",
    });
  });

  it("passes on BigModel's sentence in its own language", async () => {
    expect(
      await failure(429, {
        code: "1113",
        message: "您的账户已欠费，请充值后重试",
      }),
    ).toMatchObject({
      code: "outOfCredits",
      message: expect.stringContaining("(Z.ai: 您的账户已欠费，请充值后重试)"),
    });
  });
});
