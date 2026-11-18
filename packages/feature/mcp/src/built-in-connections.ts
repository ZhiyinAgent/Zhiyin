/**
 * The connections the application supplies: opening them in the pool, one per
 * conversation where they are scoped to conversations, their state, and
 * releasing them.
 */

import type {
  ConnectionTool,
  McpServerDefinition,
  McpServerState,
} from "@zhiyin/contract";
import type { BuiltInMcpServer } from "./connection-types.js";
import { reasonOf } from "./connection-problems.js";
import { BuiltInDescriptions } from "./built-in-descriptions.js";
import { builtInStates } from "./built-in-states.js";
import type { ConnectedServer, ConnectionPool } from "./connection-pool.js";

const builtInRefusal =
  "This connection is built in to Zhiyin and cannot be changed.";

/** A built-in's connection for one scope, open in the pool. */
export type OpenBuiltIn = {
  readonly server: McpServerDefinition;
  readonly connectionKey: string;
  readonly connected: ConnectedServer;
};

export class BuiltInConnections {
  readonly #servers: readonly BuiltInMcpServer[];
  readonly #pool: ConnectionPool;
  /** What each conversation-scoped built-in offers, once it has said. */
  readonly #described = new BuiltInDescriptions();

  constructor(servers: readonly BuiltInMcpServer[], pool: ConnectionPool) {
    this.#servers = servers;
    this.#pool = pool;
  }

  ids(): readonly string[] {
    return this.#servers.map((server) => server.id);
  }

  /** Built-in connections have no stored definition to look up. */
  has(id: string): boolean {
    return this.#servers.some((server) => server.id === id);
  }

  find(id: string): BuiltInMcpServer | undefined {
    return this.#servers.find((server) => server.id === id);
  }

  /** Refuses a change to a built-in: it has nothing a person can set. */
  refuse(id: string): void {
    if (this.has(id)) throw new Error(builtInRefusal);
  }

  #key(server: BuiltInMcpServer, scope?: string): string | undefined {
    if (server.scope !== "conversation") return server.id;
    return scope ? `${server.id}\0${scope}` : undefined;
  }

  /**
   * Opens each built-in for the scope, apart from the excluded ones. Without a
   * scope, only those not scoped to conversations open.
   */
  async open(
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Promise<void> {
    await Promise.all(
      this.#servers.map(async (server) => {
        // A withheld connection is not opened on a conversation's account.
        if (excludedServerIds.includes(server.id)) return;
        const key = this.#key(server, scope);
        if (!key) return;
        // A failure is not cached the way an external server's is: a built-in's
        // prerequisite (a browser, a shell) is cheap to re-check and the fix
        // usually happens outside the app, so every look at the connections
        // tries again rather than requiring a person to explicitly retry.
        if (this.#pool.open.has(key)) return;
        await this.#pool.openWith(
          key,
          () => server.open(scope),
          async (error) => ({
            status: "failed",
            reason: reasonOf(
              error,
              "This built-in connection could not be started.",
            ),
          }),
        );
      }),
    );
  }

  /** Asks each conversation-scoped built-in what it offers, once. */
  describe(): Promise<void> {
    return this.#described.describe(this.#servers);
  }

  /** The built-ins open for the scope, apart from the excluded ones. */
  *openFor(
    scope: string | undefined,
    excluded: ReadonlySet<string>,
  ): Iterable<OpenBuiltIn> {
    for (const server of this.#servers) {
      if (excluded.has(server.id)) continue;
      const connectionKey = this.#key(server, scope);
      if (!connectionKey) continue;
      const connected = this.#pool.open.get(connectionKey);
      if (!connected) continue;
      yield {
        server: { id: server.id, name: server.name, url: "", enabled: true },
        connectionKey,
        connected,
      };
    }
  }

  /**
   * What each built-in offers apart from any conversation: what one scoped to
   * conversations describes of itself, or what the one connection of another
   * lists. One that has said nothing, or failed, is left out.
   */
  *offered(): Iterable<{
    readonly server: McpServerDefinition;
    readonly tools: readonly ConnectionTool[];
  }> {
    for (const server of this.#servers) {
      const tools =
        server.scope === "conversation"
          ? this.#described.health(server.id).tools
          : this.#pool.open.get(server.id)?.tools;
      if (tools)
        yield {
          server: { id: server.id, name: server.name, url: "", enabled: true },
          tools,
        };
    }
  }

  states(): McpServerState[] {
    return builtInStates(this.#servers, {
      connected: this.#pool.open,
      failures: this.#pool.failures,
      described: this.#described,
    });
  }

  /**
   * Lists the tools of every open built-in again, without closing it, and has
   * the rest describe themselves again on the next look.
   */
  async listAgain(): Promise<void> {
    this.#described.clear();
    await this.#pool.listAgain((key) => this.has(key.split("\0")[0] ?? key));
  }

  /** Releases each conversation-scoped built-in's connection for the scope. */
  async shutdownScope(scope: string): Promise<void> {
    const scoped = this.#servers.filter(
      (server) => server.scope === "conversation",
    );
    await Promise.all(
      scoped.map(async (server) => {
        const key = this.#key(server, scope);
        if (key) await this.#pool.disconnect(key);
        await server.forget?.(scope);
      }),
    );
  }

  /** Each conversation-scoped built-in's scopes open or being opened. */
  openScopes(): readonly OpenScope[] {
    return this.#servers.flatMap((server) => {
      if (server.scope !== "conversation") return [];
      const prefix = `${server.id}\0`;
      return this.#pool
        .keys()
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ server, scope: key.slice(prefix.length) }));
    });
  }

  /**
   * Releases the scopes once their connections are closed, and forgets what
   * each built-in said it offers.
   */
  async release(scopes: readonly OpenScope[]): Promise<void> {
    this.#described.clear();
    await Promise.all(
      scopes.map(({ server, scope }) => server.forget?.(scope)),
    );
  }
}

type OpenScope = { readonly server: BuiltInMcpServer; readonly scope: string };
