/**
 * Each connection's credential, kept in the credential store: a key the person
 * pasted, or a sign-in. Each is kept with the endpoint it was given for and
 * answered only for that one, so a connection pointed elsewhere, however its
 * settings were lost, sends nothing it was not given. Whether one is held is
 * cached so routine management does not reopen the store.
 */

import { OAuthError, refreshAuthorization } from "@modelcontextprotocol/client";
import type { McpCredentialState } from "@zhiyin/contract";
import { PiecewiseCredential } from "@zhiyin/credential-store";
import type { McpCredentialStore } from "./credentials.js";
import {
  authRequestMs,
  limitedFetch,
  nodeNetwork,
  type Network,
} from "./network.js";
import { SignedInStore, type SignedIn } from "./signed-in.js";

const STORAGE_UNAVAILABLE = "Secure storage for access tokens is unavailable.";

/** A sign-in is refreshed this long before its token ends. */
const REFRESH_AHEAD_MS = 60_000;

/**
 * The answers by which a service refuses a refresh: the grant, or the app,
 * is no longer accepted. Anything else, an error page or a limit included,
 * says nothing about the sign-in.
 */
const refusals = new Set([
  "invalid_grant",
  "invalid_client",
  "unauthorized_client",
]);

/** Whether a sign-in's token has not yet ended. */
function stillValid(signedIn: SignedIn, now: number): boolean {
  const lifetime = signedIn.tokens.expires_in;
  return lifetime === undefined || signedIn.issuedAt + lifetime * 1_000 > now;
}

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
  readonly #states = new Map<
    string,
    { readonly endpoint: string; readonly state: McpCredentialState }
  >();
  /** One refresh at a time per connection: a second would void the first. */
  readonly #refreshing = new Map<string, Promise<string | undefined>>();
  /**
   * Moves on whenever the person signs in, pastes a key or signs out, so a
   * refresh that set off before then knows its answer is no longer wanted.
   */
  readonly #generations = new Map<string, number>();
  /**
   * Each connection's credential is written in several steps, so one write
   * runs at a time per connection: the last asked for is the last to land.
   */
  readonly #writing = new Map<string, Promise<unknown>>();
  readonly #now: () => number;
  readonly #network: Network;
  readonly #limitMs: number;

  constructor(
    store: McpCredentialStore,
    now: () => number = Date.now,
    network: Network = nodeNetwork,
    limitMs = authRequestMs,
  ) {
    this.#store = store;
    this.#limitMs = limitMs;
    this.#signedIn = new SignedInStore(store);
    this.#now = now;
    this.#network = network;
  }

  /**
   * The token a connection sends: the pasted key, or the sign-in's, refreshed
   * first when it is about to end. While the refresh cannot be made, the
   * token it has is sent until it ends.
   */
  async token(id: string, endpoint: string): Promise<string | undefined> {
    const key = await this.#keyFor(id, endpoint);
    if (key) return key;
    const signedIn = await this.#signedInFor(id, endpoint);
    if (!signedIn) return undefined;
    if (!endingSoon(signedIn, this.#now())) return signedIn.tokens.access_token;
    const refreshed = await this.refresh(id, endpoint);
    if (refreshed) return refreshed;
    const kept = await this.#signedInFor(id, endpoint);
    return kept?.tokens.access_token === signedIn.tokens.access_token &&
      stillValid(kept, this.#now())
      ? kept.tokens.access_token
      : undefined;
  }

  /**
   * A new token for a signed-in connection, after the service refused the one
   * it had. When the service refuses the refresh too, the sign-in is
   * forgotten, so the connection asks to be signed in again. When it cannot
   * be reached or answers anything else, the sign-in is kept for later
   * (ADR 0021), and there is no new token.
   */
  refresh(id: string, endpoint: string): Promise<string | undefined> {
    const pending = this.#refreshing.get(id);
    if (pending) return pending;
    const refreshing = this.#refresh(id, endpoint).finally(() =>
      this.#refreshing.delete(id),
    );
    this.#refreshing.set(id, refreshing);
    return refreshing;
  }

  /**
   * A connection's pasted key, kept in pieces when it is longer than one
   * credential entry holds, as an identity provider's token often is.
   */
  #key(id: string): PiecewiseCredential {
    const store = this.#store;
    return new PiecewiseCredential(
      (name) => ({
        getPassword: () => store.get(name),
        setPassword: (value) => store.set(name, value),
        deletePassword: () => store.delete(name),
      }),
      id,
    );
  }

  /** The pasted key, when it was given for this endpoint. */
  async #keyFor(id: string, endpoint: string): Promise<string | undefined> {
    const text = await this.#key(id).get();
    if (text === undefined) return undefined;
    try {
      const kept = JSON.parse(text) as { endpoint?: unknown; key?: unknown };
      return kept.endpoint === endpoint && typeof kept.key === "string"
        ? kept.key
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** The sign-in, when it was made for this endpoint. */
  async #signedInFor(
    id: string,
    endpoint: string,
  ): Promise<SignedIn | undefined> {
    const signedIn = await this.#signedIn.read(id);
    return signedIn?.endpoint === endpoint ? signedIn : undefined;
  }

  #generation(id: string): number {
    return this.#generations.get(id) ?? 0;
  }

  #moveOn(id: string): void {
    this.#generations.set(id, this.#generation(id) + 1);
  }

  /** Runs one write to a connection's credential once the ones before it end. */
  #inTurn<T>(id: string, write: () => Promise<T>): Promise<T> {
    const before = this.#writing.get(id) ?? Promise.resolve();
    const written = before.then(write, write);
    const settled = written.catch(() => undefined);
    this.#writing.set(id, settled);
    void settled.then(() => {
      if (this.#writing.get(id) === settled) this.#writing.delete(id);
    });
    return written;
  }

  async #refresh(id: string, endpoint: string): Promise<string | undefined> {
    const generation = this.#generation(id);
    // Read behind the writes already asked for, so a sign-out or sign-in
    // being written is what it refreshes, or not.
    const signedIn = await this.#inTurn(id, () =>
      this.#signedInFor(id, endpoint),
    );
    if (!signedIn) return undefined;
    const refreshToken = signedIn.tokens.refresh_token;
    if (!refreshToken) {
      if (generation !== this.#generation(id))
        return this.#inTurn(id, () => this.#current(id, endpoint));
      await this.forget(id);
      return undefined;
    }
    try {
      const tokens = await refreshAuthorization(signedIn.authorizationServer, {
        clientInformation: signedIn.client,
        refreshToken,
        ...(signedIn.metadata ? { metadata: signedIn.metadata } : {}),
        ...(signedIn.resource ? { resource: new URL(signedIn.resource) } : {}),
        fetchFn: limitedFetch(this.#network, this.#limitMs),
      });
      return await this.#inTurn(id, async () => {
        // The person signed out or in again while it was asked for, or while
        // a write before this one ran.
        if (generation !== this.#generation(id))
          return this.#current(id, endpoint);
        const next: SignedIn = {
          ...signedIn,
          tokens: { refresh_token: refreshToken, ...tokens },
          issuedAt: this.#now(),
        };
        await this.#signedIn.write(id, next);
        return next.tokens.access_token;
      });
    } catch (error) {
      // What the person did meanwhile answers a call that joined this one.
      if (generation !== this.#generation(id))
        return this.#inTurn(id, () => this.#current(id, endpoint));
      // A refusal ends the sign-in; an unreachable service, or one that
      // answers with an error page or a limit, leaves it for later.
      if (error instanceof OAuthError && refusals.has(error.code))
        await this.forget(id);
      return undefined;
    }
  }

  /** The token the connection holds now: the pasted key, or the sign-in's. */
  async #current(id: string, endpoint: string): Promise<string | undefined> {
    return (
      (await this.#keyFor(id, endpoint)) ??
      (await this.#signedInFor(id, endpoint))?.tokens.access_token
    );
  }

  /** What is held for this endpoint: one given for another counts as none. */
  async state(id: string, endpoint: string): Promise<McpCredentialState> {
    const cached = this.#states.get(id);
    if (cached?.endpoint === endpoint) return cached.state;
    let state: McpCredentialState;
    try {
      state = (await this.#keyFor(id, endpoint))
        ? { status: "saved" }
        : (await this.#signedInFor(id, endpoint))
          ? { status: "signed-in" }
          : { status: "none" };
    } catch {
      // Not kept: storage that comes back is asked again on the next look.
      return { status: "unavailable", reason: STORAGE_UNAVAILABLE };
    }
    this.#states.set(id, { endpoint, state });
    return state;
  }

  save(id: string, endpoint: string, token: string): Promise<void> {
    this.#moveOn(id);
    return this.#inTurn(id, async () => {
      try {
        await this.#key(id).set(JSON.stringify({ endpoint, key: token }));
      } catch (error) {
        this.#states.delete(id);
        throw new Error(STORAGE_UNAVAILABLE, { cause: error });
      }
      this.#states.set(id, { endpoint, state: { status: "saved" } });
    });
  }

  saveSignIn(id: string, endpoint: string, signedIn: SignedIn): Promise<void> {
    this.#moveOn(id);
    return this.#inTurn(id, async () => {
      try {
        await this.#signedIn.write(id, { ...signedIn, endpoint });
      } catch (error) {
        await this.#signedIn.delete(id).catch(() => undefined);
        this.#states.delete(id);
        throw new Error(STORAGE_UNAVAILABLE, { cause: error });
      }
      this.#states.set(id, { endpoint, state: { status: "signed-in" } });
    });
  }

  /** Forgets the key and the sign-in. True only when both are known gone. */
  forget(id: string): Promise<boolean> {
    this.#moveOn(id);
    return this.#inTurn(id, async () => {
      try {
        await this.#key(id).delete();
        await this.#signedIn.delete(id);
        this.#states.delete(id);
        return true;
      } catch {
        this.#states.delete(id);
        return false;
      }
    });
  }

  /** Stops answering for a connection that is no longer declared. */
  drop(id: string): void {
    this.#states.delete(id);
  }
}
