/** Z.ai's side of the wire, as its documentation describes it. */

import type { ModelFetch } from "../../../model-client.js";
import {
  chunksThenDone,
  labClient,
  recording as recordingOf,
  refusal,
  type LabClientOptions,
  type Sent,
} from "../../../../test/lab-wire.js";
import { zai } from "../../../../test/shipped-providers.js";

export { drain, untilFailure } from "../../../../test/lab-wire.js";
export type { Sent } from "../../../../test/lab-wire.js";

/**
 * A refusal in the status line, with Z.ai's business code and sentence. The
 * code arrives as a string in Z.ai's examples and as a number in its schema.
 */
export function refusing(
  status: number,
  error?: { readonly code: string | number; readonly message: string },
  headers: Record<string, string> = {},
): ModelFetch {
  return refusal(status, error ? { error } : undefined, headers);
}

/**
 * An answer ending as Z.ai's streaming guide shows: the last chunk carries
 * both the finish reason and the usage.
 */
export function endingWith(finishReason: string, text = "Done.") {
  return chunksThenDone([
    {
      id: "answer-1",
      model: "glm-5.3",
      choices: [{ index: 0, delta: { reasoning_content: "Thinking." } }],
    },
    {
      id: "answer-1",
      model: "glm-5.3",
      choices: [{ index: 0, delta: { content: text } }],
    },
    {
      id: "answer-1",
      model: "glm-5.3",
      choices: [
        {
          index: 0,
          finish_reason: finishReason,
          delta: { role: "assistant", content: "" },
        },
      ],
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 100_000,
        total_tokens: 1_100_000,
        prompt_tokens_details: { cached_tokens: 400_000 },
      },
    },
  ]);
}

/** Records each request, then answers it as `answer` does. */
export function recording(
  sent: Sent[],
  answer: ModelFetch = endingWith("stop"),
) {
  return recordingOf(sent, answer);
}

export function zaiClient(
  options: LabClientOptions & {
    readonly region?: "international" | "mainland";
  } = {},
) {
  return labClient(zai, "zai-test-key", {
    ...options,
    model: options.model ?? "glm-5.3",
    region: options.region ?? "international",
    at: "2026-10-10T12:00:00Z",
  });
}
