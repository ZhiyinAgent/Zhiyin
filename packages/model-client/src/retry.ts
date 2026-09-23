/**
 * When a failed model request is sent again, and how long it waits first.
 * ADR 0049.
 *
 * Before anything has been passed on, a retryable failure is simply sent
 * again: the caller never learns of it beyond a `retrying` note. After that
 * the caller holds part of an answer, and a repeat would hand it a second
 * copy. Only a caller that marked its request `restartable` - one that can
 * take back what it received - gets a repeat then, announced by a
 * `restarting` event that tells it to discard the failed attempt.
 */

import type { ModelRetryRecord } from "@zhiyin/contract";
import type { ModelClientErrorCode } from "./failures.js";
import type { ModelEvent } from "./index.js";

/** Attempts before anything was passed on, the first included. */
export const maximumAttempts = 5;
/**
 * Repeats after something was passed on. Fewer, because each one pays for the
 * answer's output again.
 */
export const maximumRestarts = 3;
/** Beyond this much waiting in total, the failure is reported instead. */
const maximumTotalWaitMs = 120_000;
/** A provider asking for longer than this is not waited on in full. */
const longestRequestedWaitMs = 60_000;
const firstWaitMs = 1_000;
const longestOwnWaitMs = 30_000;

/** How the waiting is done. Replaced in tests, so no test waits for real. */
export type RetryOptions = {
  readonly wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => number;
  /** A number in [0, 1), spreading waits so retries do not arrive together. */
  readonly random?: () => number;
};

type RetryFailure = {
  readonly code: ModelClientErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
};

type Repeat = {
  /** How long the next attempt waits. */
  readonly delayMs: number;
  readonly reason: ModelClientErrorCode;
  readonly message: string;
};

/** A failed attempt is about to be sent again; nothing was passed on from it. */
export type RetryingEvent = Repeat & {
  readonly kind: "retrying";
  /** The attempt about to be made, counting the first as 1. */
  readonly attempt: number;
  readonly maximumAttempts: number;
};

/**
 * A failed attempt whose events were passed on is about to be started again.
 * Everything received since the request began is void; the new attempt's
 * events follow.
 */
export type RestartingEvent = Repeat & {
  readonly kind: "restarting";
  /** Which restart this is, counting from 1. */
  readonly restart: number;
  readonly maximumRestarts: number;
};

/**
 * How long to wait before repeat number `repeat + 1`. The provider's
 * Retry-After when it gave one, up to a minute; otherwise a random wait below a
 * ceiling that doubles from one second to thirty ("full jitter").
 */
function delayMs(
  failure: RetryFailure,
  repeat: number,
  random: () => number,
): number {
  if (failure.retryAfterMs !== undefined)
    return Math.min(failure.retryAfterMs, longestRequestedWaitMs);
  const ceiling = Math.min(longestOwnWaitMs, firstWaitMs * 2 ** repeat);
  return Math.round(ceiling * random());
}

/** A wait that ends early, rejecting, the moment `signal` aborts. */
function abortableWait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    function stop() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", stop, { once: true });
  });
}

function retryableFailure(error: unknown): RetryFailure | undefined {
  return error instanceof Error &&
    error.name === "ModelClientError" &&
    (error as Partial<RetryFailure>).retryable === true
    ? (error as Error & RetryFailure)
    : undefined;
}

/**
 * The events of `attempt()`, repeated after a retryable failure within the
 * limits above. The attempts that failed are recorded on the response that
 * finally arrives.
 */
export async function* withRetries(
  attempt: () => AsyncIterable<ModelEvent>,
  request: { readonly signal?: AbortSignal; readonly restartable?: boolean },
  options: RetryOptions = {},
): AsyncIterable<ModelEvent> {
  const wait = options.wait ?? abortableWait;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const started = now();
  const retries: ModelRetryRecord[] = [];
  let silent = 0;
  let restarts = 0;
  for (;;) {
    let passedOn = false;
    try {
      for await (const event of attempt()) {
        passedOn = true;
        yield event.kind === "done" && event.response && retries.length
          ? { ...event, response: { ...event.response, retries: [...retries] } }
          : event;
      }
      return;
    } catch (error) {
      const failure = retryableFailure(error);
      const allowed = passedOn
        ? request.restartable === true && restarts < maximumRestarts
        : silent < maximumAttempts - 1;
      if (!failure || !allowed || request.signal?.aborted) throw error;
      const pause = delayMs(failure, silent + restarts, random);
      if (now() - started + pause > maximumTotalWaitMs) throw error;
      const repeat = {
        delayMs: pause,
        reason: failure.code,
        message: failure.message,
      };
      if (passedOn) {
        restarts += 1;
        retries.push({
          failure: failure.code,
          delayMs: pause,
          kind: "restart",
        });
        yield {
          kind: "restarting",
          restart: restarts,
          maximumRestarts,
          ...repeat,
        };
      } else {
        silent += 1;
        retries.push({ failure: failure.code, delayMs: pause, kind: "silent" });
        yield {
          kind: "retrying",
          attempt: silent + restarts + 1,
          maximumAttempts,
          ...repeat,
        };
      }
      await wait(pause, request.signal);
    }
  }
}
