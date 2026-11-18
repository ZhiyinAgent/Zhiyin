/**
 * The open connections, by key: one per declared connection, by its id, and
 * one per built-in, or per conversation for a built-in scoped to them. Each is
 * opened once at a time; an opening overtaken by a disconnect is closed and
 * leaves nothing behind.
 */

import type { ConnectionTool, McpServerDefinition } from "@zhiyin/contract";
import type { McpConnection } from "./connection-types.js";
import {
  McpUnauthorizedError,
  RETRY_AFTER_MS,
  unreachable,
  type Failure,
} from "./connection-problems.js";

export type ConnectedServer = {
  readonly connection: McpConnection;
  readonly tools: readonly ConnectionTool[];
};

export class ConnectionPool {
  readonly #connected = new Map<string, ConnectedServer>();
  readonly #connecting = new Map<string, Promise<void>>();
  readonly #epochs = new Map<string, number>();
  readonly #failures = new Map<string, Failure>();
  /** When each connection last answered or failed to. */
  readonly #checkedAt = new Map<string, number>();
  readonly #now: () => number;
  readonly #dial: (server: McpServerDefinition) => Promise<McpConnection>;
  readonly #refusal: (server: McpServerDefinition) => Promise<string>;

  constructor(
    now: () => number,
    /** Opens a declared connection. */
    dial: (server: McpServerDefinition) => Promise<McpConnection>,
    /** What a declared connection that refused its credential is told. */
    refusal: (server: McpServerDefinition) => Promise<string>,
  ) {
    this.#now = now;
    this.#dial = dial;
    this.#refusal = refusal;
  }

  /** The connections open now. */
  get open(): ReadonlyMap<string, ConnectedServer> {
    return this.#connected;
  }

  /** Why each connection that failed is not open. */
  get failures(): ReadonlyMap<string, Failure> {
    return this.#failures;
  }

  checkedAt(key: string): number | undefined {
    return this.#checkedAt.get(key);
  }

  /** Every key open or being opened. */
  keys(): readonly string[] {
    return [
      ...new Set([...this.#connected.keys(), ...this.#connecting.keys()]),
    ];
  }

  fail(key: string, failure: Failure): void {
    this.#failures.set(key, failure);
  }

  forgetFailure(key: string): void {
    this.#failures.delete(key);
  }

  /** Forgets the failures waiting cannot mend, so the next look tries again. */
  retryFailed(): void {
    for (const [key, failure] of [...this.#failures.entries()])
      if (failure.status === "failed") this.#failures.delete(key);
  }

  /**
   * Reaches a declared connection, unless it is open or failed. An unreachable
   * one is dialled again once its wait is over; a refused credential or an
   * invalid endpoint is not.
   */
  async reach(
    server: McpServerDefinition,
    onConnecting?: (connectionName: string) => void,
  ): Promise<void> {
    const failure = this.#failures.get(server.id);
    if (failure?.retryAt !== undefined && this.#now() >= failure.retryAt)
      this.#failures.delete(server.id);
    if (this.#connected.has(server.id) || this.#failures.has(server.id)) return;
    onConnecting?.(server.name);
    await this.openWith(
      server.id,
      () => this.#dial(server),
      async (error) => {
        if (error instanceof McpUnauthorizedError)
          return {
            status: "unauthorized",
            reason: await this.#refusal(server),
          };
        return {
          status: "failed",
          reason: unreachable("Could not connect to this MCP server.", error),
          retryAt: this.#now() + RETRY_AFTER_MS,
        };
      },
    );
  }

  /**
   * Opens the connection under `key` and lists its tools, joining an opening
   * already under way. One that fails is recorded with what `failed` says.
   */
  async openWith(
    key: string,
    dial: () => Promise<McpConnection>,
    failed: (error: unknown) => Promise<Failure>,
  ): Promise<void> {
    const pending = this.#connecting.get(key);
    if (pending) return pending;
    const connecting = this.#open(key, dial, failed);
    this.#connecting.set(key, connecting);
    try {
      await connecting;
    } finally {
      if (this.#connecting.get(key) === connecting)
        this.#connecting.delete(key);
    }
  }

  async #open(
    key: string,
    dial: () => Promise<McpConnection>,
    failed: (error: unknown) => Promise<Failure>,
  ): Promise<void> {
    const epoch = this.#epoch(key);
    let connection: McpConnection | undefined;
    try {
      connection = await dial();
      const tools = await connection.listTools();
      if (this.#epoch(key) !== epoch) {
        await connection.close();
        return;
      }
      const opened = connection;
      this.#connected.set(key, { connection: opened, tools });
      this.#failures.delete(key);
      this.#checkedAt.set(key, this.#now());
      // New tools carry a new schema, and so a new approval identity.
      opened.onToolsChanged?.((changed) => {
        if (this.#connected.get(key)?.connection === opened)
          this.#connected.set(key, { connection: opened, tools: changed });
      });
    } catch (error) {
      await connection?.close().catch(() => undefined);
      if (this.#epoch(key) !== epoch) return;
      const failure = await failed(error);
      if (this.#epoch(key) !== epoch) return;
      this.#checkedAt.set(key, this.#now());
      this.#failures.set(key, failure);
    }
  }

  /**
   * Lists the tools of the open connections `which` names again, without
   * closing them. A listing that fails keeps the tools it had.
   */
  async listAgain(which: (key: string) => boolean): Promise<void> {
    await Promise.all(
      [...this.#connected]
        .filter(([key]) => which(key))
        .map(async ([key, connected]) => {
          const tools = await connected.connection
            .listTools()
            .catch(() => undefined);
          // Kept only while that connection is still the one open.
          if (tools && this.#connected.get(key) === connected)
            this.#connected.set(key, { ...connected, tools });
        }),
    );
  }

  /** Closes one connection and forgets what it last said. */
  async disconnect(key: string): Promise<void> {
    this.#moveOn(key);
    this.#connecting.delete(key);
    const connected = this.#connected.get(key);
    this.#connected.delete(key);
    this.#failures.delete(key);
    this.#checkedAt.delete(key);
    if (connected) await connected.connection.close().catch(() => undefined);
  }

  /** Closes every connection, and abandons every one being opened. */
  async closeAll(): Promise<void> {
    for (const key of this.keys()) this.#moveOn(key);
    await Promise.all(
      [...this.#connected.values()].map(({ connection }) =>
        connection.close().catch(() => undefined),
      ),
    );
    this.#connected.clear();
  }

  #epoch(key: string): number {
    return this.#epochs.get(key) ?? 0;
  }

  #moveOn(key: string): void {
    this.#epochs.set(key, this.#epoch(key) + 1);
  }
}
