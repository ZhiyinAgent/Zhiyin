/**
 * A connection's credential changing: a key saved or cleared, or a sign-in.
 * Each is written in turn with the other changes; the connector is dialled
 * again after it, so a slow one holds no other call.
 */

import type { McpServerDefinition, McpSignInOutcome } from "@zhiyin/contract";
import { SIGN_IN, UNAUTHORIZED } from "./connection-problems.js";
import type { ConnectionPool } from "./connection-pool.js";
import type { ConnectionSignIns } from "./connection-sign-ins.js";
import type { ConnectionTokens } from "./connection-tokens.js";
import type { SavedConnectionsFile } from "./saved-connections.js";
import type { ReconciledServers } from "./server-reconcile.js";
import { SignInProblem } from "./sign-in.js";

export class CredentialChanges {
  readonly #servers: ReconciledServers;
  readonly #saved: SavedConnectionsFile;
  readonly #tokens: ConnectionTokens;
  readonly #signIns: ConnectionSignIns;
  readonly #pool: ConnectionPool;
  readonly #refuseBuiltIn: (id: string) => void;

  constructor({
    servers,
    saved,
    tokens,
    signIns,
    pool,
    refuseBuiltIn,
  }: {
    readonly servers: ReconciledServers;
    readonly saved: SavedConnectionsFile;
    readonly tokens: ConnectionTokens;
    readonly signIns: ConnectionSignIns;
    readonly pool: ConnectionPool;
    readonly refuseBuiltIn: (id: string) => void;
  }) {
    this.#servers = servers;
    this.#saved = saved;
    this.#tokens = tokens;
    this.#signIns = signIns;
    this.#pool = pool;
    this.#refuseBuiltIn = refuseBuiltIn;
  }

  async save(id: string, token: string): Promise<void> {
    await this.#redial(await this.#servers.inTurn(() => this.#save(id, token)));
  }

  async clear(id: string): Promise<void> {
    await this.#redial(await this.#servers.inTurn(() => this.#clear(id)));
  }

  async signIn(id: string, signal: AbortSignal): Promise<McpSignInOutcome> {
    this.#refuseBuiltIn(id);
    const server = await this.#servers.inTurn(async () =>
      (await this.#servers.reconcile()).find((item) => item.id === id),
    );
    if (!server)
      return { status: "failed", reason: "The MCP server no longer exists." };
    const url = server.url;
    return this.#signIns.run(id, url, signal, async (signedIn) => {
      const current = await this.#servers.inTurn(async () => {
        const found = (await this.#servers.reconcile()).find(
          (item) => item.id === id,
        );
        // Signed in for an address the connection no longer has: kept nowhere.
        if (!found || found.url !== url)
          throw new SignInProblem(
            "The connector changed while you were signing in.",
          );
        await this.#saved.remember(id, url);
        await this.#tokens.saveSignIn(id, url, signedIn);
        await this.#pool.disconnect(found.id);
        return found;
      });
      await this.#redial(current);
    });
  }

  /**
   * What a connection refused while connecting is told: to sign in, when its
   * service offers the standard sign-in and it holds no key, asked of the
   * service once; otherwise that its key was refused.
   */
  async refusedOnConnect(server: McpServerDefinition): Promise<string> {
    if ((await this.#tokens.state(server.id, server.url)).status === "saved")
      return UNAUTHORIZED;
    return (await this.#signIns.offers(server.id, server.url))
      ? SIGN_IN
      : UNAUTHORIZED;
  }

  /**
   * What a call refused mid-use is told: to sign in, when its service is
   * known to offer it and it holds no credential at all.
   */
  async refusedMidCall(id: string, url: string): Promise<string> {
    return this.#signIns.offered(id) &&
      (await this.#tokens.state(id, url)).status === "none"
      ? SIGN_IN
      : UNAUTHORIZED;
  }

  async #save(
    id: string,
    token: string,
  ): Promise<McpServerDefinition | undefined> {
    this.#refuseBuiltIn(id);
    const value = token.trim();
    if (!value) throw new Error("Enter an access token before saving.");
    const definitions = await this.#servers.reconcile();
    const server = definitions.find((item) => item.id === id);
    if (!server) throw new Error("The MCP server no longer exists.");
    // The endpoint is written down before the token exists, so a token is
    // never held for a connection nothing remembers.
    await this.#saved.remember(id, server.url);
    await this.#tokens.save(id, server.url, value);
    await this.#pool.disconnect(server.id);
    return server;
  }

  async #clear(id: string): Promise<McpServerDefinition | undefined> {
    this.#refuseBuiltIn(id);
    const definitions = await this.#servers.reconcile();
    await this.#tokens.forget(id);
    const server = definitions.find((item) => item.id === id);
    if (server) await this.#pool.disconnect(server.id);
    return server;
  }

  /**
   * A credential is read when connecting, so a connection whose credential
   * changed is reached again, if it is switched on.
   */
  async #redial(server: McpServerDefinition | undefined): Promise<void> {
    if (server?.enabled) await this.#pool.reach(server);
  }
}
