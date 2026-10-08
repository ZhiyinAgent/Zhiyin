import {
  SdkError,
  SdkErrorCode,
  SdkHttpError,
} from "@modelcontextprotocol/client";
import type { McpServerDefinition } from "@zhiyin/contract";
import { routedName } from "./action-title.js";

export const UNAUTHORIZED =
  "This server refused the access token. Save a current token to sign in again.";

export const SIGN_IN = "Sign in to use this connector.";

/**
 * A server rejected our credential. Distinct from an unreachable server: the
 * remedy is a new token, not a retry.
 */
export class McpUnauthorizedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "McpUnauthorizedError";
  }
}

/**
 * A server answered HTTP 429: it refused the request before acting on it, so
 * sending it again cannot repeat an effect. Not a lost connection.
 */
export class McpRateRefusedError extends Error {
  /** The wait the server asked for, when it said. */
  readonly retryAfterMs: number | undefined;

  constructor(retryAfterMs?: number) {
    super("The server refused the request: too many requests.");
    this.name = "McpRateRefusedError";
    this.retryAfterMs = retryAfterMs;
  }
}

export type Failure = {
  readonly status: "failed" | "unauthorized";
  readonly reason: string;
  /**
   * When an unreachable server is tried again without being asked. Absent for
   * what waiting cannot mend: a refused token, an invalid endpoint.
   */
  readonly retryAt?: number;
};

/** Long enough not to hammer a server that is down; short enough to ride out a blip. */
export const RETRY_AFTER_MS = 30_000;

/**
 * What went wrong reaching a server, in words a person can act on. Only causes
 * recognised here are named: an error's own message may carry anything, and
 * nothing unvetted is shown.
 */
function connectionProblem(error: unknown): string | undefined {
  if (error instanceof McpRateRefusedError)
    return "The server refused because too many requests were sent.";
  if (SdkHttpError.isInstance(error))
    return `The server answered with HTTP ${error.status}.`;
  if (SdkError.isInstance(error)) {
    if (error.code === SdkErrorCode.RequestTimeout)
      return "The server did not answer in time.";
    if (error.code === SdkErrorCode.ConnectionClosed)
      return "The server closed the connection.";
    return undefined;
  }
  if (error instanceof TypeError && error.message === "fetch failed") {
    const cause = (error.cause as { code?: unknown } | undefined)?.code;
    return cause === "ENOTFOUND" || cause === "EAI_AGAIN"
      ? "The server's address could not be found. Check the internet connection."
      : "The server could not be reached.";
  }
  return undefined;
}

export function unreachable(lead: string, error: unknown): string {
  const problem = connectionProblem(error);
  return problem ? `${lead} ${problem}` : lead;
}

/**
 * Why a tool the model was offered can no longer be reached. The model and the
 * person are both owed the connection that is down, not a sentence that would
 * fit any missing tool.
 */
export function whyUnavailable(
  name: string,
  definitions: readonly McpServerDefinition[],
  connected: ReadonlyMap<string, unknown>,
  failures: ReadonlyMap<string, Failure>,
): string {
  const owner = definitions
    .filter((server) => name.startsWith(routedName(server.id, "")))
    // Ids may contain each other's names: the longest prefix is the owner.
    .sort((a, b) => b.id.length - a.id.length)[0];
  const generic = "This MCP tool is no longer available.";
  // A server the person switched off, or one that lacks the tool, is
  // what "no longer available" already says. Only a connection that broke
  // needs to be named.
  if (!owner?.enabled || connected.has(owner.id)) return generic;
  const failure = failures.get(owner.id);
  return failure
    ? `${owner.name} is not connected. ${failure.reason} The person can retry it from the plugin's page.`
    : `${owner.name} is not connected right now.`;
}
