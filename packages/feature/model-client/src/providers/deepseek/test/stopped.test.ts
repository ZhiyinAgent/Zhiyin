/**
 * An answer DeepSeek stops before it is finished. Besides `stop`, `length`
 * and `tool_calls`, DeepSeek documents `content_filter`,
 * `insufficient_system_resource` and `aborted` as reasons an answer ends (API
 * reference, create chat completion, checked 2026-10-14). Each is a failed
 * request, never a finished answer.
 */

import { describe, expect, it } from "vitest";
import { deepSeekClient, drain, endingWith } from "./support.js";

async function stoppedWith(reason: string) {
  try {
    await drain(deepSeekClient({ fetcher: endingWith(reason) }), {
      messages: [{ role: "user", content: "Hello" }],
    });
  } catch (error) {
    return error;
  }
  throw new Error("The request did not fail.");
}

describe("an answer DeepSeek stops before it is finished", () => {
  it("is a refusal when DeepSeek's content filter stopped it, and is not sent again", async () => {
    expect(await stoppedWith("content_filter")).toMatchObject({
      code: "refused",
      retryable: false,
      message: "DeepSeek's content filter stopped the answer.",
    });
  });

  it("is sent again when DeepSeek ran out of capacity partway through", async () => {
    expect(await stoppedWith("insufficient_system_resource")).toMatchObject({
      code: "modelUnavailable",
      retryable: true,
    });
  });

  it("is sent again when DeepSeek interrupted it", async () => {
    expect(await stoppedWith("aborted")).toMatchObject({
      code: "networkFailure",
      retryable: true,
    });
  });
});
