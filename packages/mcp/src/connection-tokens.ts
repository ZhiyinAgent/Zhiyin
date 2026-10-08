/**
 * Each connection's credential, kept in the credential store: a key the person
 * pasted, or a sign-in. Whether one is held is cached so routine management
 * does not reopen the store.
 */

import { OAuthError, refreshAuthorization } from "@modelcontextprotocol/client";
import type { McpCredentialState } from "@zhiyin/contract";
import type { McpCredentialStore } from "./credentials.js";
import { SignedInStore, type SignedIn } from "./signed-in.js";

const STORAGE_UNAVAILABLE = "Secure storage for access tokens is unavailable.";

/** A sign-in is refreshed this long before its token ends. */
const REFRESH_AHEAD_MS = 60_000;

function endingSoon(signedIn: SignedIn, now: number): boolean {
  const lifetime = signedIn.tokens.expires_in;
  return (
    lifetime !== undefined &&
    signedIn.issuedAt + lifetime * 1_000 - REFRESH_AHEAD_MS <= now
  );
}

export class ConnectionTokens {
  readonly #store: McpCredentialStore;
  readonly #signedIn: SignedInStore;
  readonly #states = new Map<string, McpCredentialState>();
  /** One refresh at a time per connection: a second would void the first. */
  readonly #refreshing = new Map<string, Promise<string | undefined>>();
  readonly #now: () => number;

  constructor(store: McpCredentialStore, now: () => number = Date.now) {
    this.#store = store;
    this.#signedIn = new SignedInStore(store);
    this.#now = now;
  }

  /**
   * The token a connection sends: the pasted key, or the sign-in's, refreshed
   * first when it is about to end.
   */
  async token(id: string): Promise<string | undefined> {
    const key = await this.#store.get(id);
    if (key) return key;
    const signedIn = await this.#signedIn.read(id);
    if (!signedIn) return undefined;
    if (!endingSoon(signedIn, this.#now())) return signedIn.tokens.access_token;
    return this.refresh(id);
  }

  /**
   * A new token for a signed-in connection, after the service refused the one
   * it had. When the service refuses the refresh too, the sign-in is
   * forgotten, so the connection asks to be signed in again.
   */
  refresh(id: string): Promise<string | undefined> {
    const pending = this.#refreshing.get(id);
    if (pending) return pending;
    const refreshing = this.#refresh(id).finally(() =>
      this.#refreshing.delete(id),
    );
    this.#refreshing.set(id, refreshing);
    return refreshing;
  }

  async #refresh(id: string): Promise<string | undefined> {
    const signedIn = await this.#signedIn.read(id);
    if (!signedIn) return undefined;
    const refreshToken = signedIn.tokens.refresh_token;
    if (!refreshToken) {
      await this.forget(id);
      return undefined;
    }
    try {
      const tokens = await refreshAuthorization(signedIn.authorizationServer, {
        clientInformation: signedIn.client,
        refreshToken,
        ...(signedIn.metadata ? { metadata: signedIn.metadata } : {}),
        ...(signedIn.resource ? { resource: new URL(signedIn.resource) } : {}),
      });
      const next: SignedIn = {
        ...signedIn,
        tokens: { refresh_token: refreshToken, ...tokens },
        issuedAt: this.#now(),
      };
      await this.#signedIn.write(id, next);
      return next.tokens.access_token;
    } catch (error) {
      // A refusal ends the sign-in; an unreachable service leaves it for later.
      if (error instanceof OAuthError) await this.forget(id);
      return undefined;
    }
  }

  async state(id: string): Promise<McpCredentialState> {
    const cached = this.#states.get(id);
    if (cached) return cached;
    let state: McpCredentialState;
    try {
      state = (await this.#store.get(id))
        ? { status: "saved" }
        : (await this.#signedIn.read(id))
          ? { status: "signed-in" }
          : { status: "none" };
    } catch {
      state = { status: "unavailable", reason: STORAGE_UNAVAILABLE };
    }
    this.#states.set(id, state);
    return state;
  }

  async save(id: string, token: string): Promise<void> {
    try {
      await this.#store.set(id, token);
    } catch (error) {
      this.#states.set(id, {
        status: "unavailable",
        reason: STORAGE_UNAVAILABLE,
      });
      throw new Error(STORAGE_UNAVAILABLE, { cause: error });
    }
    this.#states.set(id, { status: "saved" });
  }

  async saveSignIn(id: string, signedIn: SignedIn): Promise<void> {
    try {
      await this.#signedIn.write(id, signedIn);
    } catch (error) {
      await this.#signedIn.delete(id).catch(() => undefined);
      this.#states.set(id, {
        status: "unavailable",
        reason: STORAGE_UNAVAILABLE,
      });
      throw new Error(STORAGE_UNAVAILABLE, { cause: error });
    }
    this.#states.set(id, { status: "signed-in" });
  }

  /** Forgets the key and the sign-in. True only when both are known gone. */
  async forget(id: string): Promise<boolean> {
    try {
      await this.#store.delete(id);
      await this.#signedIn.delete(id);
      this.#states.set(id, { status: "none" });
      return true;
    } catch {
      this.#states.set(id, {
        status: "unavailable",
        reason: STORAGE_UNAVAILABLE,
      });
      return false;
    }
  }

  /** Stops answering for a connection that is no longer declared. */
  drop(id: string): void {
    this.#states.delete(id);
  }
}
