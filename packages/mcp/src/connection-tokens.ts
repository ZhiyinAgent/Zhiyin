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

  async #refresh(id: string): Promise<string | undefined> {
    const generation = this.#generation(id);
    // Read behind the writes already asked for, so a sign-out or sign-in
    // being written is what it refreshes, or not.
    const signedIn = await this.#inTurn(id, () => this.#signedIn.read(id));
    if (!signedIn) return undefined;
    const refreshToken = signedIn.tokens.refresh_token;
    if (!refreshToken) {
      if (generation !== this.#generation(id))
        return this.#inTurn(id, () => this.#current(id));
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
      return await this.#inTurn(id, async () => {
        // The person signed out or in again while it was asked for, or while
        // a write before this one ran.
        if (generation !== this.#generation(id)) return this.#current(id);
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
        return this.#inTurn(id, () => this.#current(id));
      // A refusal ends the sign-in; an unreachable service leaves it for later.
      if (error instanceof OAuthError) await this.forget(id);
      return undefined;
    }
  }

  /** The token the connection holds now: the pasted key, or the sign-in's. */
  async #current(id: string): Promise<string | undefined> {
    return (
      (await this.#store.get(id)) ??
      (await this.#signedIn.read(id))?.tokens.access_token
    );
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
      // Not kept: storage that comes back is asked again on the next look.
      return { status: "unavailable", reason: STORAGE_UNAVAILABLE };
    }
    this.#states.set(id, state);
    return state;
  }

  save(id: string, token: string): Promise<void> {
    this.#moveOn(id);
    return this.#inTurn(id, async () => {
      try {
        await this.#store.set(id, token);
      } catch (error) {
        this.#states.delete(id);
        throw new Error(STORAGE_UNAVAILABLE, { cause: error });
      }
      this.#states.set(id, { status: "saved" });
    });
  }

  saveSignIn(id: string, signedIn: SignedIn): Promise<void> {
    this.#moveOn(id);
    return this.#inTurn(id, async () => {
      try {
        await this.#signedIn.write(id, signedIn);
      } catch (error) {
        await this.#signedIn.delete(id).catch(() => undefined);
        this.#states.delete(id);
        throw new Error(STORAGE_UNAVAILABLE, { cause: error });
      }
      this.#states.set(id, { status: "signed-in" });
    });
  }

  /** Forgets the key and the sign-in. True only when both are known gone. */
  forget(id: string): Promise<boolean> {
    this.#moveOn(id);
    return this.#inTurn(id, async () => {
      try {
        await this.#store.delete(id);
        await this.#signedIn.delete(id);
        this.#states.set(id, { status: "none" });
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
