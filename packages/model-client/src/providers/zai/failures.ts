/**
 * What a Z.ai failure means, on either platform. A refused request carries an
 * HTTP status and, in `{error: {code, message}}`, a business code that says
 * more than the status: 429 is a rate limit, an overloaded model or an empty
 * balance, told apart only by the code (error codes pages of Z.ai and
 * BigModel, checked 2026-10-09). The code arrives as a string in their
 * examples and as a number in Z.ai's schema, so both are read. Z.ai's own
 * sentence is passed on with every failure.
 *
 * Once a stream has begun, a failure arrives instead as the reason the answer
 * stopped: `sensitive`, `network_error` or `model_context_window_exceeded`.
 */

import {
  ModelClientError,
  retryAfterMs,
  type FailureReport,
} from "../../failures.js";

function said(failure: FailureReport): string | undefined {
  const message = failure.error?.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : undefined;
}

function businessCode(failure: FailureReport): number | undefined {
  const code = failure.error?.code;
  if (typeof code === "number") return code;
  return typeof code === "string" && /^\d+$/.test(code.trim())
    ? Number(code)
    : undefined;
}

const tooLarge = "The request is too large for the selected model.";

function rejectedKey(explained: (ours: string) => string) {
  return new ModelClientError(
    "unauthorized",
    explained("Z.ai rejected the API key. Check it on the Model page."),
  );
}

export function classifyFailure(failure: FailureReport): ModelClientError {
  const sentence = said(failure);
  /** Our sentence, then Z.ai's in its own words where it gave one. */
  const explained = (ours: string) =>
    sentence ? `${ours} (Z.ai: ${sentence})` : ours;
  const wait = retryAfterMs(failure.headers);
  const waiting = wait === undefined ? {} : { retryAfterMs: wait };

  switch (businessCode(failure)) {
    case 1000:
    case 1001:
    case 1003:
    case 1005:
      return rejectedKey(explained);
    case 1113:
      return new ModelClientError(
        "outOfCredits",
        explained(
          "The Z.ai account has run out of balance. Top it up, then try again.",
        ),
      );
    case 1211:
      return new ModelClientError(
        "modelUnavailable",
        explained(
          `Z.ai does not know the model "${failure.model ?? ""}". Choose another on the Model page.`,
        ),
        { retryable: false },
      );
    case 1234:
      return new ModelClientError(
        "networkFailure",
        explained("Z.ai had a network error."),
      );
    case 1261:
      return new ModelClientError("contextExceeded", explained(tooLarge));
    case 1301:
      return new ModelClientError(
        "refused",
        explained("Z.ai's content filter declined the request."),
      );
    case 1302:
      return new ModelClientError(
        "rateLimited",
        explained(
          "Z.ai is limiting how fast requests are sent. Trying again shortly.",
        ),
        waiting,
      );
    case 1305:
      return new ModelClientError(
        "modelUnavailable",
        explained("The model is overloaded on Z.ai right now."),
        { retryable: true, ...waiting },
      );
  }

  if (failure.status === 401) return rejectedKey(explained);
  if (failure.status === 429)
    return new ModelClientError(
      "rateLimited",
      explained(
        "Z.ai is limiting how fast requests are sent. Trying again shortly.",
      ),
      waiting,
    );
  if (failure.status >= 500 || failure.status === 0)
    return new ModelClientError(
      "unexplainedError",
      sentence
        ? explained("Z.ai's server failed.")
        : "Z.ai's server failed without saying why.",
    );
  return new ModelClientError(
    "requestRejected",
    explained("Z.ai refused the request."),
  );
}

/** The failure a finish reason names, or undefined for an ended answer. */
export function failedFinish(reason: string): ModelClientError | undefined {
  switch (reason) {
    case "sensitive":
      return new ModelClientError(
        "refused",
        "Z.ai's content filter stopped the answer.",
      );
    case "network_error":
      return new ModelClientError(
        "networkFailure",
        "Z.ai's model failed while answering.",
      );
    case "model_context_window_exceeded":
      return new ModelClientError("contextExceeded", tooLarge);
    default:
      return undefined;
  }
}
