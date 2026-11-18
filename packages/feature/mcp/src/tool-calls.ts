/**
 * A call to a connection's tool: laid out for approval, checked again against
 * that approval, sent (a remote one in its turn), and its answer read.
 */

import type {
  ActionEffects,
  ConnectionTool,
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";
import { ProtocolError } from "@modelcontextprotocol/client";
import { withSchemaProblems } from "@zhiyin/tool-input";
import type { BuiltInMcpServer } from "./connection-types.js";
import type { ConnectionPool } from "./connection-pool.js";
import type { RoutedTool } from "./tool-routes.js";
import { actionTitle } from "./action-title.js";
import { asArguments } from "./call-arguments.js";
import { approvalIdentity, changedSinceApproval } from "./approval-identity.js";
import {
  McpRateRefusedError,
  McpUnauthorizedError,
  McpUndeclaredAnswerError,
  reasonOf,
  unreachable,
} from "./connection-problems.js";
import { callResult } from "./call-result.js";
import { CallPacing, LONGEST_COOL_DOWN_MS } from "./call-pacing.js";
import { rateRefusal } from "./rate-refusal.js";
import { inputMismatch } from "./input-validation.js";
import { describeCall, sentTo } from "./call-description.js";
import type { McpExecuteOptions } from "./mcp-servers.js";

/** A call stopped before it was sent. */
const STOPPED = "The action was stopped.";

/** An action stopped once sent, here or on a server, may have run. */
const STOPPED_AFTER_SENDING =
  "Stopped. The action may already have taken effect; check what it changes before retrying.";

/**
 * How many times a call refused for rate before the service acted is sent
 * again, each after its connection's wait.
 */
const RESENDS_AFTER_REFUSAL = 3;

const TOO_MANY_REQUESTS =
  "The service refused this call because too many requests were sent. Later calls to it wait before they are sent.";

/** As much of a server's own error as a reason carries. */
function serverWords(message: string): string {
  return message.trim().slice(0, 1_000);
}

export class ToolCalls {
  readonly #route: ToolRoute;
  readonly #builtIn: (id: string) => BuiltInMcpServer | undefined;
  readonly #pool: ConnectionPool;
  readonly #rate: (id: string) => number | undefined;
  readonly #refused: (id: string, url: string) => Promise<string>;
  readonly #said: SaidOfTools;
  readonly #now: () => number;
  readonly #pacing = new CallPacing();

  constructor({
    route,
    builtIn,
    pool,
    rate,
    refused,
    said,
    now,
  }: {
    /** The tool a name goes to, once its connection is reached, or why none. */
    readonly route: ToolRoute;
    readonly builtIn: (id: string) => BuiltInMcpServer | undefined;
    readonly pool: ConnectionPool;
    /** A declared connection's calls a minute, where it gives them. */
    readonly rate: (id: string) => number | undefined;
    /** What a call whose credential was refused mid-use is told. */
    readonly refused: (id: string, url: string) => Promise<string>;
    /** What a declaration and the person say of a declared connection's tools. */
    readonly said: SaidOfTools;
    readonly now: () => number;
  }) {
    this.#route = route;
    this.#builtIn = builtIn;
    this.#pool = pool;
    this.#rate = rate;
    this.#refused = refused;
    this.#said = said;
    this.#now = now;
  }

  async inspect(
    name: string,
    args: unknown,
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Promise<ToolCallInspection> {
    const route = await this.#route(name, scope, excludedServerIds);
    if (typeof route === "string") return { ok: false, reason: route };
    const builtIn = this.#builtIn(route.server.id);
    // A call that does not fit its schema would be refused after the person
    // approved, built in or not. A built-in's inspection then checks what a
    // schema cannot state. The
    // validator's words come first; the shared checker's follow where they
    // say more, as which field the tool does not take.
    const mismatch = inputMismatch(route.tool, asArguments(args));
    if (mismatch)
      return {
        ok: false,
        correctable: true,
        reason: withSchemaProblems(
          mismatch,
          asArguments(args),
          route.tool.inputSchema,
        ),
      };
    const presentation = await builtIn?.inspect?.(
      route.tool.name,
      asArguments(args),
      scope,
    );
    if (presentation && !presentation.ok) return presentation;
    // The person's word about a tool counts only for a connection Zhiyin
    // neither builds in nor ships.
    const personSays = builtIn
      ? undefined
      : this.#said.personSays(route.server.id, route.tool);
    const effects = builtIn
      ? undefined
      : this.#said.effectsOf(
          route.server.id,
          route.tool.name,
          asArguments(args),
        );
    return {
      ok: true,
      action: actionTitle(route.server.name, route.tool.name),
      target: route.server.name,
      ...sentTo(route.server.url),
      // Laid out from the tool's own schema, so a connection added tomorrow is
      // as readable as a built-in one. A built-in that describes its own call
      // better keeps its version: the spread below lets it win.
      invocation: describeCall(
        route.tool.name,
        asArguments(args),
        route.server.url,
        route.tool.inputSchema,
      ),
      ...presentation,
      // Only a built-in's own inspection reaches this object, and whether
      // the connection is built in is this feature's knowledge, not its claim.
      ...(builtIn ? { builtInConnection: true as const } : {}),
      // What a package Zhiyin ships says a tool does is Zhiyin's word, so a
      // call of that tool goes as one to a connection Zhiyin ships; the rest
      // of the connection's tools are asked about as any server's are.
      ...(effects ? { effects, effectsDeclaredByZhiyin: true as const } : {}),
      ...(personSays ? { personSays } : {}),
      connection: route.server.name,
      connectionId: route.server.id,
      identity: approvalIdentity(
        { id: route.server.id, url: route.server.url },
        route.tool.inputSchema,
        route.tool.description,
        presentation?.identity,
      ),
      // A built-in connection knows its own arguments — which of them run to
      // pages of text, and how they read — so its own wording stands. Only a
      // server that says nothing is described from out here.
      command:
        presentation?.ok && presentation.command
          ? presentation.command
          : `${name}(${JSON.stringify(asArguments(args))})`,
    };
  }

  async execute(
    name: string,
    args: unknown,
    {
      signal,
      expectedIdentity,
      scope,
      excludedServerIds = [],
    }: McpExecuteOptions = {},
  ): Promise<ToolInvocationResult> {
    if (signal?.aborted) return { ok: false, reason: STOPPED };
    const route = await this.#route(name, scope, excludedServerIds);
    if (typeof route === "string") return { ok: false, reason: route };
    const builtIn = this.#builtIn(route.server.id);
    const current =
      expectedIdentity !== undefined || builtIn?.inspect
        ? await this.inspect(name, args, scope, excludedServerIds)
        : undefined;
    // Refused, it says why: the call's own reason, what it acts on, or the
    // connection.
    if (current && !current.ok) return { ok: false, reason: current.reason };
    const changed =
      current && expectedIdentity !== undefined
        ? changedSinceApproval(current.identity, expectedIdentity)
        : undefined;
    if (changed) return { ok: false, reason: changed };
    const present = (result: ToolInvocationResult): ToolInvocationResult => {
      const describe = builtIn?.describeResult;
      if (!describe) return result;
      try {
        return {
          ...result,
          details: describe(route.tool.name, asArguments(args), result, scope),
        };
      } catch {
        return result;
      }
    };
    try {
      const binding: string | undefined =
        current?.ok && current.identity
          ? (JSON.parse(current.identity) as { action?: string }).action
          : undefined;
      const send = () =>
        builtIn?.inspect
          ? route.connection.callTool(
              route.tool.name,
              asArguments(args),
              signal,
              binding,
            )
          : signal
            ? route.connection.callTool(
                route.tool.name,
                asArguments(args),
                signal,
              )
            : route.connection.callTool(route.tool.name, asArguments(args));
      if (!builtIn) return await this.#sendPaced(route, send, signal);
      // A built-in runs on this machine: it has no rate to keep. Stopped
      // while it was being reached, it was never sent.
      if (signal?.aborted) return { ok: false, reason: STOPPED };
      const value = await send();
      if (signal?.aborted) return { ok: false, reason: STOPPED_AFTER_SENDING };
      return callResult(
        value,
        present,
        () =>
          builtIn.produced?.(
            route.tool.name,
            asArguments(args),
            value,
            scope,
          ) ?? [],
      );
    } catch (error) {
      if (signal?.aborted) return { ok: false, reason: STOPPED_AFTER_SENDING };
      if (builtIn)
        return present({
          ok: false,
          reason: reasonOf(
            error,
            "The built-in connection could not complete this action.",
          ),
        });
      return this.#remoteFailure(route, error);
    }
  }

  /** A remote call that threw, and what it leaves of its connection. */
  async #remoteFailure(
    route: RoutedTool,
    error: unknown,
  ): Promise<ToolInvocationResult> {
    // The server answered, so the connection is as sound as it was. An
    // answer unlike the tool's declared output comes from a call that ran.
    if (error instanceof McpUndeclaredAnswerError)
      return {
        ok: false,
        reason: `The MCP server ran the call, but its answer does not match the output the tool declares, so it is not used. The action may already have taken effect: check before calling it again. ${serverWords(error.message)}`,
      };
    if (ProtocolError.isInstance(error))
      return {
        ok: false,
        reason: `The MCP server answered the call with an error: ${serverWords(error.message) || `code ${error.code}`}`,
      };
    await this.#pool.disconnect(route.connectionKey);
    if (error instanceof McpUnauthorizedError) {
      const refusal = await this.#refused(
        route.connectionKey,
        route.server.url,
      );
      this.#pool.fail(route.connectionKey, {
        status: "unauthorized",
        reason: refusal,
      });
      return { ok: false, reason: refusal };
    }
    this.#pool.fail(route.connectionKey, {
      status: "failed",
      reason: unreachable("The connection to this MCP server was lost.", error),
      // It answered a moment ago, so the next look dials again at once; only
      // a failure to connect waits.
      retryAt: this.#now(),
    });
    // A call lost on the way may have reached the server: the model is told
    // so, not that nothing happened, so it does not simply repeat it.
    return {
      ok: false,
      reason:
        "The connection to the MCP server was lost during the call, so the action may already have taken effect. Check before calling it again.",
    };
  }

  /**
   * Sends a call to a remote connection in its turn, and reads a refusal for
   * rate as a failure whatever the result claims. A refusal with a status of
   * 429, from the transport or in the result, came before the service acted,
   * so the call is sent again after the wait, up to three times.
   */
  async #sendPaced(
    route: RoutedTool,
    send: () => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<ToolInvocationResult> {
    for (let attempt = 1; ; attempt += 1) {
      // Waiting its turn is still before dispatch: a call stopped here was
      // never sent.
      const call = await this.#pacing.turn(
        route.connectionKey,
        this.#rate(route.server.id),
        signal,
      );
      if (!call) return { ok: false, reason: STOPPED };
      let value: unknown;
      try {
        value = await send();
      } catch (error) {
        if (!(error instanceof McpRateRefusedError) || signal?.aborted) {
          call.finished("failed");
          throw error;
        }
        call.finished("refused", error.retryAfterMs);
        if (
          attempt <= RESENDS_AFTER_REFUSAL &&
          (error.retryAfterMs ?? 0) <= LONGEST_COOL_DOWN_MS
        )
          continue;
        return { ok: false, reason: TOO_MANY_REQUESTS };
      }
      if (signal?.aborted) {
        call.finished("failed");
        return { ok: false, reason: STOPPED_AFTER_SENDING };
      }
      const refusal = rateRefusal(value);
      call.finished(refusal === undefined ? "answered" : "refused");
      if (refusal?.beforeActing && attempt <= RESENDS_AFTER_REFUSAL) continue;
      if (refusal !== undefined)
        return {
          ok: false,
          reason: `${TOO_MANY_REQUESTS} The service said: ${refusal.said}`,
        };
      return callResult(
        value,
        (result) => result,
        () => [],
      );
    }
  }
}

/**
 * Reaches what a call needs and finds the tool its name routes to, or answers
 * why it cannot be reached.
 */
export type ToolRoute = (
  name: string,
  scope: string | undefined,
  excludedServerIds: readonly string[],
) => Promise<RoutedTool | string>;

/** What a declaration and the person say of a declared connection's tools. */
type SaidOfTools = {
  effectsOf(
    id: string,
    toolName: string,
    args: Readonly<Record<string, unknown>>,
  ): ActionEffects | undefined;
  personSays(
    id: string,
    tool: ConnectionTool,
  ): "ask-each-time" | "only-reads" | undefined;
};
