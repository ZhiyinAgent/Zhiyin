/**
 * The declared connections joined to what is remembered about each, and the
 * queue every change to that memory runs in, one at a time.
 */

import type {
  ActionEffects,
  ConnectionTool,
  ConnectionToolTreatment,
  McpServerDefinition,
} from "@zhiyin/contract";
import type {
  DeclaredMcpServer,
  DeclaredMcpServers,
  UnreadableMcpPackages,
} from "./mcp-servers.js";
import {
  SavedConnectionsFile,
  type SavedConnections,
} from "./saved-connections.js";
import type { ConnectionTokens } from "./connection-tokens.js";
import type { ConnectionSignIns } from "./connection-sign-ins.js";
import type { ConnectionPool } from "./connection-pool.js";
import { reasonOf } from "./connection-problems.js";
import { validateDefinition } from "./endpoint.js";
import { DeclaredEffects } from "./declared-effects.js";
import { ToolTreatments, withToolTreatment } from "./tool-treatments.js";
import { Serial } from "@zhiyin/one-at-a-time";

export class ReconciledServers {
  readonly #mutations = new Serial();
  #definitions: McpServerDefinition[] | undefined;
  /** Each declared connection's rate, where it gives one. */
  #rates: ReadonlyMap<string, number> = new Map();
  /** Each declared connection's tools that its declaration says only read. */
  #readOnly: ReadonlyMap<string, ReadonlySet<string>> = new Map();
  /** What each declared connection's declaration says its tools do. */
  readonly #effects = new DeclaredEffects();
  /** How the person asked each tool of a connection Zhiyin does not ship to be treated. */
  readonly #treatments = new ToolTreatments();
  /** Connections held back because the saved settings could not be read. */
  readonly #waitingForSaved = new Set<string>();
  readonly #saved: SavedConnectionsFile;
  readonly #declared: DeclaredMcpServers;
  readonly #unreadable: UnreadableMcpPackages;
  readonly #tokens: ConnectionTokens;
  readonly #signIns: ConnectionSignIns;
  readonly #pool: ConnectionPool;
  readonly #isBuiltIn: (id: string) => boolean;

  constructor({
    saved,
    declared,
    unreadable,
    tokens,
    signIns,
    pool,
    isBuiltIn,
  }: {
    readonly saved: SavedConnectionsFile;
    readonly declared: DeclaredMcpServers;
    readonly unreadable: UnreadableMcpPackages;
    readonly tokens: ConnectionTokens;
    readonly signIns: ConnectionSignIns;
    readonly pool: ConnectionPool;
    readonly isBuiltIn: (id: string) => boolean;
  }) {
    this.#saved = saved;
    this.#declared = declared;
    this.#unreadable = unreadable;
    this.#tokens = tokens;
    this.#signIns = signIns;
    this.#pool = pool;
    this.#isBuiltIn = isBuiltIn;
  }

  /** Runs one change after those before it, and answers what it returns. */
  inTurn<T>(operation: () => Promise<T>): Promise<T> {
    return this.#mutations.run(operation);
  }

  /** The connections as last reconciled. */
  get current(): readonly McpServerDefinition[] {
    return this.#definitions ?? [];
  }

  /** The calls a minute a connection's declaration allows, where it says. */
  rate(id: string): number | undefined {
    return this.#rates.get(id);
  }

  /**
   * Whether a connection's declaration says one of its tools only reads: by
   * listing it, or by what it says the tool does.
   */
  readsOnly(id: string, toolName: string): boolean {
    return (
      (this.#readOnly.get(id)?.has(toolName) ?? false) ||
      this.#effects.readsOnly(id, toolName)
    );
  }

  /** What one call does, when its connection's declaration names its tool. */
  effectsOf(
    id: string,
    toolName: string,
    args: Readonly<Record<string, unknown>>,
  ): ActionEffects | undefined {
    return this.#effects.ofCall(id, toolName, args);
  }

  /** What the person said of this version of a tool, beyond asking once. */
  personSays(
    id: string,
    tool: ConnectionTool,
  ): "ask-each-time" | "only-reads" | undefined {
    return this.#treatments.personSays(id, tool);
  }

  /** How a tool is shown as treated; nothing for one Zhiyin ships. */
  shownTreatment(
    id: string,
    tool: ConnectionTool,
  ): {
    readonly treatment?: ConnectionToolTreatment;
    readonly version?: string;
  } {
    return this.#treatments.shown(id, tool);
  }

  /**
   * Remembers how the person asked one tool of a connection Zhiyin does not
   * ship to be treated, for the version of it they were shown.
   * Runs inside the mutation queue.
   */
  async treatTool(
    id: string,
    toolName: string,
    treatment: ConnectionToolTreatment,
    shown: string,
  ): Promise<void> {
    const definitions = await this.reconcile();
    const server = definitions.find((item) => item.id === id);
    if (!server) throw new Error("The MCP server no longer exists.");
    this.#treatments.refuseShipped(id);
    const state = await this.#saved.read();
    const remembered = withToolTreatment(
      state[id] ?? { url: server.url, disabledTools: [] },
      server.url,
      this.#pool.open.get(id)?.tools.find((tool) => tool.name === toolName),
      treatment,
      shown,
    );
    await this.#saved.write({ ...state, [id]: remembered });
    this.#treatments.keep(id, server.url, remembered);
  }

  /** The declared connections, after forgetting what is no longer declared. */
  reconciled(): Promise<McpServerDefinition[]> {
    return this.inTurn(() => this.reconcile());
  }

  /**
   * Joins what packages declare to what is remembered about each connection.
   * A connection that is no longer declared loses its token and its choices;
   * one whose endpoint changed loses its token, since a token is issued for
   * one endpoint. A choice is only dropped once its token is known to be gone,
   * so an unavailable credential store is asked again next time.
   * Runs inside the mutation queue.
   */
  async reconcile(): Promise<McpServerDefinition[]> {
    let declared: readonly DeclaredMcpServer[];
    let unreadable: readonly string[];
    try {
      [declared, unreadable] = await Promise.all([
        this.#declared(),
        this.#unreadable(),
      ]);
    } catch (error) {
      throw new Error("Connections could not be read.", { cause: error });
    }
    let state: SavedConnections;
    try {
      state = await this.#saved.read();
    } catch (error) {
      return this.#waitForSaved(
        declared,
        reasonOf(error, "Connection settings could not be read."),
      );
    }
    // Readable again: what waited for the settings is dialled afresh.
    for (const id of this.#waitingForSaved) this.#pool.forgetFailure(id);
    this.#waitingForSaved.clear();
    const next: SavedConnections = { ...state };
    const byId = new Map(declared.map((server) => [server.id, server]));
    for (const id of Object.keys(state)) {
      if (byId.has(id)) continue;
      await this.#pool.disconnect(id);
      // Not undeclared, only unread: kept for when its package opens again.
      if (unreadable.some((name) => id.startsWith(`${name}/`))) continue;
      this.#signIns.forget(id);
      if (await this.#tokens.forget(id)) {
        delete next[id];
        this.#tokens.drop(id);
      }
    }
    const definitions: McpServerDefinition[] = [];
    for (const server of declared) {
      this.#refuseBuiltInId(server);
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
        await this.#pool.disconnect(server.id);
      const disabledTools = next[server.id]?.disabledTools ?? [];
      const definition: McpServerDefinition = {
        id: server.id,
        name: server.name,
        url: server.url,
        enabled: server.enabled,
        ...(disabledTools.length ? { disabledTools } : {}),
        ...(server.toolMinutes ? { toolMinutes: server.toolMinutes } : {}),
      };
      try {
        validateDefinition(definition);
      } catch (error) {
        this.#pool.fail(server.id, {
          status: "failed",
          reason: reasonOf(error, "Invalid MCP endpoint."),
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
    this.#effects.learn(declared);
    this.#treatments.learn(declared, next);
    return definitions;
  }

  /**
   * Switches one of a connection's tools on or off, and remembers it.
   * Runs inside the mutation queue.
   */
  async switchTool(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void> {
    const definitions = await this.reconcile();
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

  #refuseBuiltInId(server: DeclaredMcpServer): void {
    if (this.#isBuiltIn(server.id))
      throw new Error(`Connection “${server.id}” is built in to Zhiyin.`);
  }

  /**
   * With the saved settings unreadable, which tools a person switched off is
   * not known, so no declared connection is reached: each is closed and shown
   * failed with the reason, and nothing is forgotten or written. Built-in
   * connections need nothing saved and carry on. Each look reads again.
   */
  async #waitForSaved(
    declared: readonly DeclaredMcpServer[],
    reason: string,
  ): Promise<McpServerDefinition[]> {
    const definitions: McpServerDefinition[] = [];
    for (const server of declared) {
      this.#refuseBuiltInId(server);
      await this.#pool.disconnect(server.id);
      if (server.enabled) {
        this.#pool.fail(server.id, { status: "failed", reason });
        this.#waitingForSaved.add(server.id);
      }
      definitions.push({
        id: server.id,
        name: server.name,
        url: server.url,
        enabled: server.enabled,
      });
    }
    this.#definitions = definitions;
    return definitions;
  }
}
