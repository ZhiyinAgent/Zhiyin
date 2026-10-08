import type {
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import type {
  BuiltInMcpServer,
  McpConnection,
  McpConnectionTool,
} from "./connection-types.js";
import { actionTitle, routedName } from "./action-title.js";
import { asArguments } from "./call-arguments.js";
import {
  McpRateRefusedError,
  McpUnauthorizedError,
  UNAUTHORIZED,
  SIGN_IN,
  RETRY_AFTER_MS,
  unreachable,
  whyUnavailable,
  type Failure,
} from "./connection-problems.js";
import { callResult } from "./call-result.js";
import { CallPacing, LONGEST_COOL_DOWN_MS } from "./call-pacing.js";
import { rateRefusal } from "./rate-refusal.js";
import { inputMismatch } from "./input-validation.js";
import { describeCall } from "./call-description.js";
import type { McpCredentialStore } from "./credentials.js";
import { SignInProblem, type SignInOptions } from "./sign-in.js";
import { ConnectionSignIns } from "./connection-sign-ins.js";
import { ConnectionTokens } from "./connection-tokens.js";
import {
  SavedConnectionsFile,
  type SavedConnections,
} from "./saved-connections.js";
import { BuiltInDescriptions } from "./built-in-descriptions.js";

/**
 * `token` is asked for the current credential rather than handed one, so a
 * transport can read it per request and no caller keeps a copy. `refresh` is
 * asked once when the service refuses it, before the refusal stands.
 */
export type McpConnectionFactory = (
  definition: McpServerDefinition,
  token: () => Promise<string | undefined>,
  refresh?: () => Promise<unknown>,
) => Promise<McpConnection>;

const builtInRefusal =
  "This connection is built in to Zhiyin and cannot be changed.";

const TOO_MANY_REQUESTS =
  "The service refused this call because too many requests were sent. Later calls to it wait before they are sent.";

/**
 * A connection some package declares. The declaration is the only source of a
 * connection's identity and endpoint; this feature keeps nothing about a
 * connection that is no longer declared.
 */
export type DeclaredMcpServer = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  /** Off when its package or the connector itself is switched off. */
  readonly enabled: boolean;
  /** The most calls a minute the service accepts; unset sends one at a time. */
  readonly requestsPerMinute?: number;
  /**
   * The tools that only read, by the server's names for them, on the word of
   * whoever declared the connection — never on the server's own annotations.
   */
  readonly readOnlyTools?: readonly string[];
};

export type DeclaredMcpServers = () => Promise<readonly DeclaredMcpServer[]>;

export interface McpServers {
  /** Every connection's state, after reaching each enabled one. */
  manage(): Promise<readonly McpServerState[]>;
  /** Every connection's state as last seen, reaching none of them. */
  states(): Promise<readonly McpServerState[]>;
  /** Reaches one connection now, whatever it last answered. */
  check(id: string): Promise<McpServerState>;
  /** Forgets remembered connection failures so the next look tries again. */
  retryFailed(): Promise<void>;
  /** The ids of the connections the application itself provides. */
  builtInIds(): readonly string[];
  setToolEnabled(id: string, toolName: string, enabled: boolean): Promise<void>;
  /** A dry run against an endpoint and (optional) token, saving nothing. */
  test(
    definition: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome>;
  saveToken(id: string, token: string): Promise<void>;
  /** Forgets the key or the sign-in, whichever the connection holds. */
  clearToken(id: string): Promise<void>;
  /**
   * Signs in through the service's own sign-in, in the person's browser, for a
   * connection whose service offers it. The signal cancels it.
   */
  signIn(id: string, signal?: AbortSignal): Promise<McpSignInOutcome>;
  /**
   * `onConnecting` hears the name of each connection this has to wait for,
   * before waiting: one reached for the first time, or one still connecting.
   */
  availableTools(
    scope?: string,
    excludedServerIds?: readonly string[],
    onConnecting?: (connectionName: string) => void,
  ): Promise<readonly ToolSpec[]>;
  inspect(
    name: string,
    args: unknown,
    scope?: string,
    excludedServerIds?: readonly string[],
  ): Promise<ToolCallInspection>;
  execute(
    name: string,
    args: unknown,
    signal?: AbortSignal,
    expectedIdentity?: string,
    scope?: string,
    excludedServerIds?: readonly string[],
  ): Promise<ToolInvocationResult>;
  shutdownScope(scope: string): Promise<void>;
  shutdownAll(): Promise<void>;
}

type ConnectedServer = {
  readonly connection: McpConnection;
  readonly tools: readonly McpConnectionTool[];
};

type RoutedTool = {
  readonly server: McpServerDefinition;
  readonly tool: McpConnectionTool;
  readonly connection: McpConnection;
  readonly connectionKey: string;
};

function validateDefinition(server: McpServerDefinition) {
  if (!server.id.trim() || !server.name.trim()) {
    throw new Error("An MCP server needs a name.");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(server.url);
  } catch {
    throw new Error("Enter a valid MCP endpoint.");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("MCP endpoints must use HTTP or HTTPS.");
  }
  if (
    endpoint.username ||
    endpoint.password ||
    [...endpoint.searchParams.keys()].some((key) =>
      /token|secret|password|api.?key/i.test(key),
    )
  )
    throw new Error(
      "Use an endpoint without embedded credentials. Save the access token separately.",
    );
}

/** Long enough to read an input by; short enough not to be a second copy of it. */
export class ManagedMcpServers implements McpServers {
  #mutations: Promise<void> = Promise.resolve();
  #enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.#mutations.then(operation);
    this.#mutations = result.catch(() => undefined);
    return result;
  }
  setToolEnabled(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void> {
    return this.#enqueue(() => this.#setToolEnabled(id, toolName, enabled));
  }
  saveToken(id: string, token: string): Promise<void> {
    return this.#enqueue(() => this.#saveToken(id, token));
  }
  clearToken(id: string): Promise<void> {
    return this.#enqueue(() => this.#clearToken(id));
  }
  readonly #saved: SavedConnectionsFile;
  readonly #connect: McpConnectionFactory;
  readonly #tokens: ConnectionTokens;
  readonly #builtIns: readonly BuiltInMcpServer[];
  readonly #declared: DeclaredMcpServers;
  readonly #connected = new Map<string, ConnectedServer>();
  readonly #connecting = new Map<string, Promise<void>>();
  readonly #epochs = new Map<string, number>();
  readonly #failures = new Map<string, Failure>();
  /** When each configured connection last answered or failed to. */
  readonly #checkedAt = new Map<string, number>();
  /** What each conversation-scoped built-in offers, once it has said. */
  readonly #described = new BuiltInDescriptions();
  #definitions: McpServerDefinition[] | undefined;
  readonly #pacing = new CallPacing();
  /** Each declared connection's rate, where it gives one. */
  #rates: ReadonlyMap<string, number> = new Map();
  /** Each declared connection's tools that its declaration says only read. */
  #readOnly: ReadonlyMap<string, ReadonlySet<string>> = new Map();
  readonly #now: () => number;
  readonly #signIns: ConnectionSignIns;

  constructor(
    directory: string,
    connect: McpConnectionFactory,
    store: McpCredentialStore,
    builtIns: readonly BuiltInMcpServer[] = [],
    declared: DeclaredMcpServers = async () => [],
    now: () => number = Date.now,
    signInOptions?: SignInOptions,
  ) {
    this.#now = now;
    this.#signIns = new ConnectionSignIns(signInOptions);
    this.#saved = new SavedConnectionsFile(directory);
    this.#connect = connect;
    this.#tokens = new ConnectionTokens(store, now);
    this.#builtIns = builtIns;
    this.#declared = declared;
  }

  /** Built-in connections have no stored definition to look up. */
  #isBuiltIn(id: string): boolean {
    return this.#builtIns.some((server) => server.id === id);
  }

  #refuseBuiltIn(id: string): void {
    if (this.#isBuiltIn(id)) throw new Error(builtInRefusal);
  }

  #builtInKey(server: BuiltInMcpServer, scope?: string): string | undefined {
    if (server.scope !== "conversation") return server.id;
    return scope ? `${server.id}\0${scope}` : undefined;
  }

  async #openBuiltIns(
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Promise<void> {
    await Promise.all(
      this.#builtIns.map(async (server) => {
        // A withheld connection is not opened on a conversation's account.
        if (excludedServerIds.includes(server.id)) return;
        const key = this.#builtInKey(server, scope);
        if (!key) return;
        // A failure is not cached the way an external server's is: a built-in's
        // prerequisite (a browser, a shell) is cheap to re-check and the fix
        // usually happens outside the app, so every `manage()` call tries again
        // rather than requiring a person to explicitly retry.
        if (this.#connected.has(key)) return;
        const pending = this.#connecting.get(key);
        if (pending) return pending;
        const connecting = (async () => {
          const epoch = this.#epochs.get(key) ?? 0;
          let connection: McpConnection | undefined;
          try {
            connection = await server.open(scope);
            const tools = await connection.listTools();
            if ((this.#epochs.get(key) ?? 0) !== epoch) {
              await connection.close();
              return;
            }
            this.#connected.set(key, { connection, tools });
          } catch (error) {
            await connection?.close().catch(() => undefined);
            if ((this.#epochs.get(key) ?? 0) === epoch)
              this.#failures.set(key, {
                status: "failed",
                reason:
                  error instanceof Error && error.message
                    ? error.message
                    : "This built-in connection could not be started.",
              });
          }
        })();
        this.#connecting.set(key, connecting);
        try {
          await connecting;
        } finally {
          if (this.#connecting.get(key) === connecting)
            this.#connecting.delete(key);
        }
      }),
    );
  }

  /**
   * A built-in's general state. One scoped to conversations speaks for itself,
   * since no single conversation's connection speaks for all of them.
   */
  #builtInHealth(server: BuiltInMcpServer): {
    tools: readonly McpConnectionTool[] | undefined;
    failure: Failure | undefined;
  } {
    if (server.scope === "conversation" && server.describe)
      return this.#described.health(server.id);
    const prefix = `${server.id}\0`;
    const connected =
      this.#connected.get(server.id) ??
      [...this.#connected.entries()].find(([key]) =>
        key.startsWith(prefix),
      )?.[1];
    const failure =
      this.#failures.get(server.id) ??
      [...this.#failures.entries()].find(([key]) =>
        key.startsWith(prefix),
      )?.[1];
    return { tools: connected?.tools, failure };
  }

  #builtInStates(): McpServerState[] {
    return this.#builtIns.map((server) => {
      const { tools, failure } = this.#builtInHealth(server);
      return {
        id: server.id,
        name: server.name,
        // It runs inside the application, so there is no address to show and
        // nothing leaves the machine on its account.
        url: "",
        enabled: true,
        builtIn: true,
        status: tools
          ? ("connected" as const)
          : (failure?.status ?? ("disconnected" as const)),
        toolCount: tools?.length ?? 0,
        tools:
          tools?.map(({ name, description }) => ({
            name,
            enabled: true,
            ...(description ? { description } : {}),
          })) ?? [],
        ...(failure ? { reason: failure.reason } : {}),
        credential: { status: "none" as const },
      };
    });
  }

  /**
   * Brings the connections in line with their declarations, reaching only the
   * enabled ones `dial` names: a look at the list must not reach every service
   * a person has set up.
   */
  async #prepare(
    dial: (id: string) => boolean,
    onConnecting?: (connectionName: string) => void,
  ): Promise<McpServerDefinition[]> {
    const definitions = await this.#reconciled();
    await Promise.all([
      this.#openBuiltIns(),
      this.#described.describe(this.#builtIns),
      ...definitions.map(async (server) => {
        if (!server.enabled) await this.#disconnect(server.id);
        else if (dial(server.id))
          await this.#ensureConnected(server, onConnecting);
      }),
    ]);
    return definitions;
  }

  /** Reaches only what this conversation may use. */
  async #prepareFor(
    scope: string | undefined,
    excluded: readonly string[],
    onConnecting?: (connectionName: string) => void,
  ): Promise<void> {
    await this.#prepare((id) => !excluded.includes(id), onConnecting);
    await this.#openBuiltIns(scope, excluded);
  }

  async manage(): Promise<readonly McpServerState[]> {
    return this.#states(await this.#prepare(() => true));
  }

  async states(): Promise<readonly McpServerState[]> {
    return this.#states(await this.#prepare(() => false));
  }

  async check(id: string): Promise<McpServerState> {
    this.#refuseBuiltIn(id);
    this.#failures.delete(id);
    const states = await this.#states(
      await this.#prepare((candidate) => candidate === id),
    );
    const state = states.find((item) => item.id === id);
    if (!state) throw new Error("The MCP server no longer exists.");
    return state;
  }

  async #states(
    definitions: readonly McpServerDefinition[],
  ): Promise<readonly McpServerState[]> {
    const configured = await Promise.all(
      definitions.map(async (server) => {
        const connected = this.#connected.get(server.id);
        const failure = this.#failures.get(server.id);
        const disabledTools = new Set(server.disabledTools ?? []);
        const checkedAt = this.#checkedAt.get(server.id);
        const status: McpServerState["status"] = connected
          ? "connected"
          : (failure?.status ??
            (server.enabled ? "unchecked" : "disconnected"));
        return {
          ...server,
          status,
          toolCount: connected?.tools.length ?? 0,
          tools:
            connected?.tools.map(({ name, description }) => ({
              name,
              enabled: !disabledTools.has(name),
              ...(description ? { description } : {}),
            })) ?? [],
          ...(failure ? { reason: failure.reason } : {}),
          ...(checkedAt === undefined ? {} : { checkedAt }),
          ...(this.#signIns.offered(server.id)
            ? { signIn: true as const }
            : {}),
          credential: await this.#tokens.state(server.id),
        };
      }),
    );
    return [...this.#builtInStates(), ...configured];
  }

  builtInIds(): readonly string[] {
    return this.#builtIns.map((server) => server.id);
  }

  async retryFailed(): Promise<void> {
    for (const [key, failure] of [...this.#failures.entries()])
      if (failure.status === "failed") this.#failures.delete(key);
  }

  async #saveToken(id: string, token: string): Promise<void> {
    this.#refuseBuiltIn(id);
    const value = token.trim();
    if (!value) throw new Error("Enter an access token before saving.");
    const definitions = await this.#reconcile();
    const server = definitions.find((item) => item.id === id);
    if (!server) throw new Error("The MCP server no longer exists.");
    // The endpoint is written down before the token exists, so a token is
    // never held for a connection nothing remembers.
    await this.#saved.remember(id, server.url);
    await this.#tokens.save(id, value);
    await this.#reconnect(server);
  }

  async #clearToken(id: string): Promise<void> {
    this.#refuseBuiltIn(id);
    const definitions = await this.#reconcile();
    await this.#tokens.forget(id);
    const server = definitions.find((item) => item.id === id);
    if (server) await this.#reconnect(server);
  }

  /** Credentials are read at connection time, so a change means reconnecting. */
  async #reconnect(server: McpServerDefinition): Promise<void> {
    await this.#disconnect(server.id);
    if (server.enabled) await this.#ensureConnected(server);
  }

  async #setToolEnabled(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void> {
    this.#refuseBuiltIn(id);
    const definitions = await this.#reconcile();
    const server = definitions.find((item) => item.id === id);
    if (!server) throw new Error("The MCP server no longer exists.");
    const state = await this.#saved.read();
    const current = state[id] ?? { url: server.url, disabledTools: [] };
    const disabled = new Set(current.disabledTools);
    if (enabled) disabled.delete(toolName);
    else disabled.add(toolName);
    const disabledTools = [...disabled].sort();
    await this.#saved.write({ ...state, [id]: { ...current, disabledTools } });
    this.#definitions = definitions.map((item) =>
      item.id === id ? { ...item, disabledTools } : item,
    );
  }

  /**
   * A dry run against a draft definition: connects, lists tools, and closes
   * immediately. Never touches `#connected`, `#failures`, or persisted state,
   * so it cannot disturb a server already connected under the same id.
   */
  async test(
    definition: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome> {
    let connection: McpConnection | undefined;
    try {
      connection = await this.#connect(definition, () =>
        Promise.resolve(token),
      );
      const tools = await connection.listTools();
      return {
        ok: true,
        tools: tools.map(({ name, description }) => ({
          name,
          enabled: true,
          ...(description ? { description } : {}),
        })),
      };
    } catch (error) {
      // A service refusing anyone without a credential still answered: the
      // address works, and says what it asks for.
      if (error instanceof McpUnauthorizedError && token === undefined)
        return (await this.#signIns.addressOffers(definition.url))
          ? {
              ok: false,
              reason:
                "This service has its own sign-in. Save the connector, then sign in to it.",
              needs: "sign-in",
            }
          : {
              ok: false,
              reason: "This service needs an access token.",
              needs: "token",
            };
      return {
        ok: false,
        reason:
          error instanceof McpUnauthorizedError
            ? UNAUTHORIZED
            : "Could not connect to this MCP server.",
      };
    } finally {
      await connection?.close().catch(() => undefined);
    }
  }

  async availableTools(
    scope?: string,
    excludedServerIds: readonly string[] = [],
    onConnecting?: (connectionName: string) => void,
  ): Promise<readonly ToolSpec[]> {
    await this.#prepareFor(scope, excludedServerIds, onConnecting);
    return [...this.#routes(scope, excludedServerIds).entries()].map(
      ([name, route]) => ({
        name,
        description:
          route.tool.description ??
          `Use ${route.tool.name} from ${route.server.name}.`,
        inputSchema: route.tool.inputSchema ?? { type: "object" },
        ...(this.#readOnly.get(route.server.id)?.has(route.tool.name)
          ? { access: "read" as const }
          : {}),
      }),
    );
  }

  async inspect(
    name: string,
    args: unknown,
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Promise<ToolCallInspection> {
    await this.#prepareFor(scope, excludedServerIds);
    const route = this.#routes(scope, excludedServerIds).get(name);
    if (!route)
      return {
        ok: false,
        reason: whyUnavailable(
          name,
          this.#definitions ?? [],
          this.#connected,
          this.#failures,
        ),
      };
    const builtIn = this.#builtIns.find(
      (server) => server.id === route.server.id,
    );
    // A built-in checks its own arguments, in words it chose. A remote call
    // that does not fit its schema would be refused after the person approved.
    const mismatch = builtIn
      ? undefined
      : inputMismatch(route.tool, asArguments(args));
    if (mismatch) return { ok: false, correctable: true, reason: mismatch };
    const presentation = await builtIn?.inspect?.(
      route.tool.name,
      asArguments(args),
      scope,
    );
    if (presentation && !presentation.ok) return presentation;
    return {
      ok: true,
      action: actionTitle(route.server.name, route.tool.name),
      target: route.server.name,
      destination: route.server.url,
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
      connection: route.server.name,
      identity: JSON.stringify({
        server: route.server,
        schema: route.tool.inputSchema,
        ...(presentation?.identity ? { action: presentation.identity } : {}),
      }),
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
    signal?: AbortSignal,
    expectedIdentity?: string,
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Promise<ToolInvocationResult> {
    if (signal?.aborted)
      return { ok: false, reason: "The action was stopped." };
    await this.#prepareFor(scope, excludedServerIds);
    const route = this.#routes(scope, excludedServerIds).get(name);
    if (!route)
      return {
        ok: false,
        reason: whyUnavailable(
          name,
          this.#definitions ?? [],
          this.#connected,
          this.#failures,
        ),
      };
    const builtIn = this.#builtIns.find(
      (server) => server.id === route.server.id,
    );
    const current =
      expectedIdentity !== undefined || builtIn?.inspect
        ? await this.inspect(name, args, scope, excludedServerIds)
        : undefined;
    if (
      current &&
      (!current.ok ||
        (expectedIdentity !== undefined &&
          current.identity !== expectedIdentity))
    )
      return {
        ok: false,
        reason:
          "The connection changed after approval. Request approval again.",
      };
    const present = (result: ToolInvocationResult): ToolInvocationResult => {
      const describe = this.#builtIns.find(
        (server) => server.id === route.server.id,
      )?.describeResult;
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
      // A built-in runs on this machine: it has no rate to keep.
      const value = await send();
      if (signal?.aborted)
        return { ok: false, reason: "The action was stopped." };
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
      if (signal?.aborted)
        return {
          ok: false,
          reason: builtIn
            ? "The action was stopped."
            : "Stopped waiting. The remote action may already have taken effect.",
        };
      if (builtIn)
        return present({
          ok: false,
          reason:
            error instanceof Error && error.message.trim()
              ? error.message
              : "The built-in connection could not complete this action.",
        });
      const refused = error instanceof McpUnauthorizedError;
      await this.#disconnect(route.connectionKey);
      const refusal =
        refused &&
        this.#signIns.offered(route.connectionKey) &&
        (await this.#tokens.state(route.connectionKey)).status === "none"
          ? SIGN_IN
          : UNAUTHORIZED;
      this.#failures.set(
        route.connectionKey,
        refused
          ? { status: "unauthorized", reason: refusal }
          : {
              status: "failed",
              reason: unreachable(
                "The connection to this MCP server was lost.",
                error,
              ),
              // It answered a moment ago, so the next look dials again at
              // once; only a failure to connect waits.
              retryAt: this.#now(),
            },
      );
      return {
        ok: false,
        reason: refused
          ? refusal
          : "The MCP server could not complete this action.",
      };
    }
  }

  /**
   * Sends a call to a remote connection in its turn, and reads a refusal for
   * rate as a failure whatever the result claims. A refusal the transport
   * reports came before the service acted, so it alone is sent once more.
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
        this.#rates.get(route.server.id),
        signal,
      );
      if (!call) return { ok: false, reason: "The action was stopped." };
      let value: unknown;
      try {
        value = await send();
      } catch (error) {
        if (!(error instanceof McpRateRefusedError) || signal?.aborted) {
          call.finished("failed");
          throw error;
        }
        call.finished("refused", error.retryAfterMs);
        if (attempt === 1 && (error.retryAfterMs ?? 0) <= LONGEST_COOL_DOWN_MS)
          continue;
        return { ok: false, reason: TOO_MANY_REQUESTS };
      }
      if (signal?.aborted) {
        call.finished("failed");
        return {
          ok: false,
          reason:
            "Stopped waiting. The remote action may already have taken effect.",
        };
      }
      const refusal = rateRefusal(value);
      call.finished(refusal === undefined ? "answered" : "refused");
      if (refusal !== undefined)
        return {
          ok: false,
          reason: `${TOO_MANY_REQUESTS} The service said: ${refusal}`,
        };
      return callResult(
        value,
        (result) => result,
        () => [],
      );
    }
  }

  async shutdownAll(): Promise<void> {
    const scopes = this.#builtIns.flatMap((server) => {
      if (server.scope !== "conversation") return [];
      const prefix = `${server.id}\0`;
      return [
        ...new Set([...this.#connected.keys(), ...this.#connecting.keys()]),
      ]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ server, scope: key.slice(prefix.length) }));
    });
    for (const id of new Set([
      ...this.#connected.keys(),
      ...this.#connecting.keys(),
    ]))
      this.#epochs.set(id, (this.#epochs.get(id) ?? 0) + 1);
    await Promise.all(
      [...this.#connected.values()].map(({ connection }) =>
        connection.close().catch(() => undefined),
      ),
    );
    this.#connected.clear();
    this.#described.clear();
    await Promise.all(
      scopes.map(({ server, scope }) => server.forget?.(scope)),
    );
  }

  async shutdownScope(scope: string): Promise<void> {
    const scoped = this.#builtIns.filter(
      (server) => server.scope === "conversation",
    );
    await Promise.all(
      scoped.map(async (server) => {
        const key = this.#builtInKey(server, scope);
        if (key) await this.#disconnect(key);
        await server.forget?.(scope);
      }),
    );
  }

  async #ensureConnected(
    server: McpServerDefinition,
    onConnecting?: (connectionName: string) => void,
  ): Promise<void> {
    const failure = this.#failures.get(server.id);
    if (failure?.retryAt !== undefined && this.#now() >= failure.retryAt)
      this.#failures.delete(server.id);
    if (this.#connected.has(server.id) || this.#failures.has(server.id)) return;
    onConnecting?.(server.name);
    const pending = this.#connecting.get(server.id);
    if (pending) return pending;
    const connecting = this.#openConnection(server);
    this.#connecting.set(server.id, connecting);
    try {
      await connecting;
    } finally {
      if (this.#connecting.get(server.id) === connecting)
        this.#connecting.delete(server.id);
    }
  }

  async #openConnection(server: McpServerDefinition): Promise<void> {
    const epoch = this.#epochs.get(server.id) ?? 0;
    let connection: McpConnection | undefined;
    try {
      connection = await this.#connect(
        server,
        () => this.#tokens.token(server.id),
        () => this.#tokens.refresh(server.id),
      );
      const tools = await connection.listTools();
      if ((this.#epochs.get(server.id) ?? 0) !== epoch) {
        await connection.close();
        return;
      }
      const opened = connection;
      this.#connected.set(server.id, { connection: opened, tools });
      this.#checkedAt.set(server.id, this.#now());
      // New tools carry a new schema, and so a new approval identity.
      opened.onToolsChanged?.((changed) => {
        if (this.#connected.get(server.id)?.connection === opened)
          this.#connected.set(server.id, {
            connection: opened,
            tools: changed,
          });
      });
    } catch (error) {
      await connection?.close().catch(() => undefined);
      if ((this.#epochs.get(server.id) ?? 0) !== epoch) return;
      const refused = error instanceof McpUnauthorizedError;
      const reason =
        refused && (await this.#signInNeeded(server)) ? SIGN_IN : UNAUTHORIZED;
      if ((this.#epochs.get(server.id) ?? 0) !== epoch) return;
      this.#checkedAt.set(server.id, this.#now());
      this.#failures.set(
        server.id,
        refused
          ? { status: "unauthorized", reason }
          : {
              status: "failed",
              reason: unreachable(
                "Could not connect to this MCP server.",
                error,
              ),
              retryAt: this.#now() + RETRY_AFTER_MS,
            },
      );
    }
  }

  /**
   * Whether a refused connection should be signed in to: its service offers
   * the standard sign-in and it holds no key. Asked of the service once.
   */
  async #signInNeeded(server: McpServerDefinition): Promise<boolean> {
    if ((await this.#tokens.state(server.id)).status === "saved") return false;
    return this.#signIns.offers(server.id, server.url);
  }

  async signIn(
    id: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<McpSignInOutcome> {
    this.#refuseBuiltIn(id);
    let server: McpServerDefinition | undefined;
    await this.#enqueue(async () => {
      server = (await this.#reconcile()).find((item) => item.id === id);
    });
    if (!server)
      return { status: "failed", reason: "The MCP server no longer exists." };
    const url = server.url;
    return this.#signIns.run(id, url, signal, (signedIn) =>
      this.#enqueue(async () => {
        const current = (await this.#reconcile()).find(
          (item) => item.id === id,
        );
        // Signed in for an address the connection no longer has: kept nowhere.
        if (!current || current.url !== url)
          throw new SignInProblem(
            "The connector changed while you were signing in.",
          );
        await this.#saved.remember(id, url);
        await this.#tokens.saveSignIn(id, signedIn);
        await this.#reconnect(current);
      }),
    );
  }

  async #disconnect(id: string): Promise<void> {
    this.#epochs.set(id, (this.#epochs.get(id) ?? 0) + 1);
    this.#connecting.delete(id);
    const connected = this.#connected.get(id);
    this.#connected.delete(id);
    this.#failures.delete(id);
    this.#checkedAt.delete(id);
    if (connected) await connected.connection.close().catch(() => undefined);
  }

  #routes(
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Map<string, RoutedTool> {
    const routes = new Map<string, RoutedTool>();
    const claimed = new Set<string>();
    // A name two tools would answer to routes to neither.
    const route = (name: string, value: RoutedTool) => {
      if (claimed.has(name)) routes.delete(name);
      else routes.set(name, value);
      claimed.add(name);
    };
    const excluded = new Set(excludedServerIds);
    for (const server of this.#builtIns) {
      if (excluded.has(server.id)) continue;
      const connectionKey = this.#builtInKey(server, scope);
      if (!connectionKey) continue;
      const connected = this.#connected.get(connectionKey);
      if (!connected) continue;
      for (const tool of connected.tools) {
        route(routedName(server.id, tool.name), {
          server: { id: server.id, name: server.name, url: "", enabled: true },
          tool,
          connection: connected.connection,
          connectionKey,
        });
      }
    }
    for (const server of this.#definitions ?? []) {
      if (excluded.has(server.id)) continue;
      const connected = this.#connected.get(server.id);
      if (!server.enabled || !connected) continue;
      const disabledTools = new Set(server.disabledTools ?? []);
      for (const tool of connected.tools) {
        if (disabledTools.has(tool.name)) continue;
        route(routedName(server.id, tool.name), {
          server,
          tool,
          connection: connected.connection,
          connectionKey: server.id,
        });
      }
    }
    return routes;
  }

  /** The declared connections, after forgetting what is no longer declared. */
  async #reconciled(): Promise<McpServerDefinition[]> {
    let result: McpServerDefinition[] = [];
    await this.#enqueue(async () => {
      result = await this.#reconcile();
    });
    return result;
  }

  /**
   * Joins what packages declare to what is remembered about each connection.
   * A connection that is no longer declared loses its token and its choices;
   * one whose endpoint changed loses its token, since a token is issued for
   * one endpoint. A choice is only dropped once its token is known to be gone,
   * so an unavailable credential store is asked again next time.
   * Runs inside the mutation queue.
   */
  async #reconcile(): Promise<McpServerDefinition[]> {
    let declared: readonly DeclaredMcpServer[];
    try {
      declared = await this.#declared();
    } catch (error) {
      throw new Error("Connections could not be read.", { cause: error });
    }
    const state = await this.#saved.read();
    const next: SavedConnections = { ...state };
    const byId = new Map(declared.map((server) => [server.id, server]));
    for (const id of Object.keys(state)) {
      if (byId.has(id)) continue;
      await this.#disconnect(id);
      this.#signIns.forget(id);
      if (await this.#tokens.forget(id)) {
        delete next[id];
        this.#tokens.drop(id);
      }
    }
    const definitions: McpServerDefinition[] = [];
    for (const server of declared) {
      if (this.#isBuiltIn(server.id))
        throw new Error(`Connection “${server.id}” is built in to Zhiyin.`);
      const remembered = next[server.id];
      if (
        remembered &&
        remembered.url !== server.url &&
        (await this.#tokens.forget(server.id))
      ) {
        next[server.id] = { url: server.url, disabledTools: [] };
        this.#signIns.forget(server.id);
      }
      const previous = this.#definitions?.find((item) => item.id === server.id);
      // Switching a connection on, or pointing it elsewhere, starts it afresh
      // rather than repeating a failure remembered from before.
      if (
        !server.enabled ||
        (previous &&
          (!previous.enabled ||
            previous.url !== server.url ||
            previous.name !== server.name))
      )
        await this.#disconnect(server.id);
      const disabledTools = next[server.id]?.disabledTools ?? [];
      const definition: McpServerDefinition = {
        id: server.id,
        name: server.name,
        url: server.url,
        enabled: server.enabled,
        ...(disabledTools.length ? { disabledTools } : {}),
      };
      try {
        validateDefinition(definition);
      } catch (error) {
        this.#failures.set(server.id, {
          status: "failed",
          reason:
            error instanceof Error ? error.message : "Invalid MCP endpoint.",
        });
      }
      definitions.push(definition);
    }
    if (JSON.stringify(next) !== JSON.stringify(state))
      await this.#saved.write(next);
    this.#definitions = definitions;
    this.#rates = new Map(
      declared.flatMap((server) =>
        server.requestsPerMinute
          ? [[server.id, server.requestsPerMinute] as const]
          : [],
      ),
    );
    this.#readOnly = new Map(
      declared.map((server) => [server.id, new Set(server.readOnlyTools)]),
    );
    return definitions;
  }
}
