import type {
  ConnectionTool,
  ConnectionToolTreatment,
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import type {
  DeclaredMcpServers,
  McpConnectionFactory,
  McpExecuteOptions,
  McpServers,
  UnreadableMcpPackages,
} from "./mcp-servers.js";
import type { BuiltInMcpServer } from "./connection-types.js";
import { whyUnavailable } from "./connection-problems.js";
import type { McpCredentialStore } from "./credentials.js";
import type { SignInOptions } from "./sign-in.js";
import { ConnectionSignIns } from "./connection-sign-ins.js";
import { ConnectionTokens } from "./connection-tokens.js";
import type { Network } from "./network.js";
import { SavedConnectionsFile } from "./saved-connections.js";
import { testConnection } from "./connection-test.js";
import { toolSummary, withheldReason } from "./schema-limit.js";
import { actionTitle, routedName } from "./action-title.js";
import { ConnectionPool } from "./connection-pool.js";
import { BuiltInConnections } from "./built-in-connections.js";
import { ReconciledServers } from "./server-reconcile.js";
import { CredentialChanges } from "./credential-changes.js";
import { routeTools, type RoutedTool } from "./tool-routes.js";
import { ToolCalls } from "./tool-calls.js";

/**
 * The connections a person and the application have, joined behind one
 * interface: what is declared, what is open, their credentials, and the calls
 * routed to them.
 */
export class ManagedMcpServers implements McpServers {
  readonly #connect: McpConnectionFactory;
  readonly #tokens: ConnectionTokens;
  readonly #signIns: ConnectionSignIns;
  readonly #pool: ConnectionPool;
  readonly #builtIns: BuiltInConnections;
  readonly #servers: ReconciledServers;
  readonly #credentials: CredentialChanges;
  readonly #calls: ToolCalls;
  /** The connection each name a tool was routed by belongs to. */
  readonly #offeredBy = new Map<string, string>();

  constructor(
    directory: string,
    connect: McpConnectionFactory,
    store: McpCredentialStore,
    {
      builtIns = [],
      declared = async () => [],
      unreadable = async () => [],
      now = Date.now,
      signInOptions,
      network,
    }: {
      readonly builtIns?: readonly BuiltInMcpServer[];
      readonly declared?: DeclaredMcpServers;
      readonly unreadable?: UnreadableMcpPackages;
      readonly now?: (() => number) | undefined;
      readonly signInOptions?: SignInOptions | undefined;
      /** How connections, sign-ins and refreshes go online (ADR 0004). */
      readonly network?: Network | undefined;
    } = {},
  ) {
    const saved = new SavedConnectionsFile(directory);
    this.#signIns = new ConnectionSignIns(signInOptions, network);
    this.#connect = (definition, token, refresh) =>
      connect(definition, token, refresh, network);
    const tokens = new ConnectionTokens(store, now, network);
    this.#tokens = tokens;
    this.#pool = new ConnectionPool(
      now,
      (server) =>
        this.#connect(
          server,
          () => tokens.token(server.id, server.url),
          () => tokens.refresh(server.id, server.url),
        ),
      (server) => this.#credentials.refusedOnConnect(server),
    );
    this.#builtIns = new BuiltInConnections(builtIns, this.#pool);
    this.#servers = new ReconciledServers({
      saved,
      declared,
      unreadable,
      tokens,
      signIns: this.#signIns,
      pool: this.#pool,
      isBuiltIn: (id) => this.#builtIns.has(id),
    });
    this.#credentials = new CredentialChanges({
      servers: this.#servers,
      saved,
      tokens,
      signIns: this.#signIns,
      pool: this.#pool,
      refuseBuiltIn: (id) => this.#builtIns.refuse(id),
    });
    this.#calls = new ToolCalls({
      route: (name, scope, excluded) => this.#routeFor(name, scope, excluded),
      builtIn: (id) => this.#builtIns.find(id),
      pool: this.#pool,
      rate: (id) => this.#servers.rate(id),
      refused: (id, url) => this.#credentials.refusedMidCall(id, url),
      said: this.#servers,
      now,
    });
  }

  setToolEnabled(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void> {
    return this.#servers.inTurn(async () => {
      this.#builtIns.refuse(id);
      await this.#servers.switchTool(id, toolName, enabled);
    });
  }

  setToolTreatment(
    id: string,
    toolName: string,
    treatment: ConnectionToolTreatment,
    shown: string,
  ): Promise<void> {
    return this.#servers.inTurn(async () => {
      this.#builtIns.refuse(id);
      await this.#servers.treatTool(id, toolName, treatment, shown);
    });
  }

  saveToken(id: string, token: string): Promise<void> {
    return this.#credentials.save(id, token);
  }

  clearToken(id: string): Promise<void> {
    return this.#credentials.clear(id);
  }

  signIn(
    id: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<McpSignInOutcome> {
    return this.#credentials.signIn(id, signal);
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
    const definitions = await this.#servers.reconciled();
    await Promise.all([
      this.#builtIns.open(),
      this.#builtIns.describe(),
      ...definitions.map(async (server) => {
        if (!server.enabled) await this.#pool.disconnect(server.id);
        else if (dial(server.id)) await this.#pool.reach(server, onConnecting);
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
    await this.#builtIns.open(scope, excluded);
  }

  /**
   * Reaches only the connection a call goes to, once it is known: a call
   * never waits on another connector being reached. A tool not yet known is
   * looked for as a list of tools would be.
   */
  async #routeFor(
    name: string,
    scope: string | undefined,
    excluded: readonly string[],
  ): Promise<RoutedTool | string> {
    await this.#builtIns.open(scope, excluded);
    const known = this.#routes(scope, excluded).get(name);
    if (!known) await this.#prepareFor(scope, excluded);
    else await this.#prepare((id) => id === known.server.id);
    return (
      this.#routes(scope, excluded).get(name) ??
      whyUnavailable(
        name,
        this.#offeredBy.get(name),
        this.#servers.current,
        this.#pool.open,
        this.#pool.failures,
      )
    );
  }

  #routes(
    scope: string | undefined,
    excludedServerIds: readonly string[],
  ): Map<string, RoutedTool> {
    const excluded = new Set(excludedServerIds);
    const routes = routeTools(
      this.#builtIns.openFor(scope, excluded),
      this.#servers.current,
      this.#pool.open,
      excluded,
    );
    for (const [name, route] of routes)
      this.#offeredBy.set(name, route.server.id);
    return routes;
  }

  async states(): Promise<readonly McpServerState[]> {
    return this.#states(await this.#prepare(() => false));
  }

  async check(id: string): Promise<McpServerState> {
    this.#builtIns.refuse(id);
    this.#pool.forgetFailure(id);
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
        const connected = this.#pool.open.get(server.id);
        const failure = this.#pool.failures.get(server.id);
        const disabledTools = new Set(server.disabledTools ?? []);
        const checkedAt = this.#pool.checkedAt(server.id);
        const status: McpServerState["status"] = connected
          ? "connected"
          : (failure?.status ??
            (server.enabled ? "unchecked" : "disconnected"));
        return {
          ...server,
          status,
          toolCount: connected?.tools.length ?? 0,
          tools:
            connected?.tools.map((tool) => ({
              ...toolSummary(tool, !disabledTools.has(tool.name)),
              ...this.#servers.shownTreatment(server.id, tool),
            })) ?? [],
          ...(failure ? { reason: failure.reason } : {}),
          ...(checkedAt === undefined ? {} : { checkedAt }),
          ...(this.#signIns.offered(server.id)
            ? { signIn: true as const }
            : {}),
          credential: await this.#tokens.state(server.id, server.url),
        };
      }),
    );
    return [...this.#builtIns.states(), ...configured];
  }

  builtInIds(): readonly string[] {
    return this.#builtIns.ids();
  }

  async retryFailed(): Promise<void> {
    this.#pool.retryFailed();
  }

  /**
   * A dry run of a draft definition; see `testConnection`. With no token
   * given, it uses the one saved for this connection and address, as the
   * connection itself would: a saved token never goes to another address.
   */
  async test(
    definition: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome> {
    const sent =
      token ?? (await this.#tokens.held(definition.id, definition.url));
    return testConnection(definition, sent, this.#connect, (url) =>
      this.#signIns.addressOffers(url),
    );
  }

  /**
   * Lists the tools of every open built-in connection again, without closing
   * it: what one offers can follow the chosen model, as the browser's
   * screenshot does. A listing that fails keeps the tools it had.
   */
  listBuiltInsAgain(): Promise<void> {
    return this.#builtIns.listAgain();
  }

  async availableTools(
    scope?: string,
    excludedServerIds: readonly string[] = [],
    onConnecting?: (connectionName: string) => void,
  ): Promise<readonly ToolSpec[]> {
    await this.#prepareFor(scope, excludedServerIds, onConnecting);
    return [...this.#routes(scope, excludedServerIds).entries()].map(
      ([name, route]) => this.#spec(name, route.server, route.tool),
    );
  }

  async builtInTools(): Promise<ReadonlyMap<string, readonly ToolSpec[]>> {
    await Promise.all([this.#builtIns.open(), this.#builtIns.describe()]);
    return new Map(
      [...this.#builtIns.offered()].map(({ server, tools }) => [
        server.id,
        tools
          .filter((tool) => !withheldReason(tool))
          .map((tool) =>
            this.#spec(routedName(server.id, tool.name), server, tool),
          ),
      ]),
    );
  }

  #spec(
    name: string,
    server: McpServerDefinition,
    tool: ConnectionTool,
  ): ToolSpec {
    const shipped = this.#builtIns.has(server.id);
    return {
      name,
      description: tool.description ?? `Use ${tool.name} from ${server.name}.`,
      inputSchema: tool.inputSchema ?? { type: "object" },
      // Named by a connection Zhiyin ships in its own words; any other by
      // the connection's name, never by what its server says of its tools.
      label:
        (shipped ? tool.label : undefined) ??
        actionTitle(server.name, tool.name),
      // Read-only on the word of its plugin's declaration, or of the code
      // of a connection Zhiyin ships; never on a server's word about itself.
      ...(this.#servers.readsOnly(server.id, tool.name) ||
      (shipped && tool.access === "read")
        ? { access: "read" as const }
        : {}),
      ...(shipped && tool.reportsState ? { reportsState: true as const } : {}),
      ...(shipped && tool.checksWork ? { checksWork: tool.checksWork } : {}),
      // The toolkit within its plugin, said only by a connection Zhiyin ships.
      ...(shipped && tool.toolkit ? { toolkit: tool.toolkit } : {}),
      connection: { id: server.id, tool: tool.name },
    };
  }

  inspect(
    name: string,
    args: unknown,
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Promise<ToolCallInspection> {
    return this.#calls.inspect(name, args, scope, excludedServerIds);
  }

  execute(
    name: string,
    args: unknown,
    options: McpExecuteOptions = {},
  ): Promise<ToolInvocationResult> {
    return this.#calls.execute(name, args, options);
  }

  async shutdownAll(): Promise<void> {
    const scopes = this.#builtIns.openScopes();
    await this.#pool.closeAll();
    await this.#builtIns.release(scopes);
  }

  shutdownScope(scope: string): Promise<void> {
    return this.#builtIns.shutdownScope(scope);
  }
}
