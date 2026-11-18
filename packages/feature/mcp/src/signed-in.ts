/**
 * A connection's sign-in, kept in the credential store like a pasted key. It
 * is longer than one Windows credential entry holds (1,280 characters), so it
 * is kept in pieces as a long key is: a sign-in half written reads as the one
 * before it, and the next write or removal clears what a failure left.
 */

import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import { PiecewiseCredential } from "@zhiyin/credential-store";
import type { McpCredentialStore } from "./credentials.js";

export type SignedIn = {
  readonly tokens: OAuthTokens;
  /** When the tokens were issued, in milliseconds since the epoch. */
  readonly issuedAt: number;
  readonly client: OAuthClientInformationMixed;
  readonly authorizationServer: string;
  readonly metadata?: AuthorizationServerMetadata;
  readonly resource?: string;
  /** The connection's endpoint it was made for, and the only one it is sent to. */
  readonly endpoint?: string;
};

export class SignedInStore {
  readonly #store: McpCredentialStore;

  constructor(store: McpCredentialStore) {
    this.#store = store;
  }

  async read(id: string): Promise<SignedIn | undefined> {
    const text = await this.#credential(id).get();
    if (text === undefined) return undefined;
    try {
      const signedIn = JSON.parse(text) as Partial<SignedIn> | null;
      return typeof signedIn === "object" &&
        signedIn !== null &&
        typeof signedIn.tokens === "object"
        ? (signedIn as SignedIn)
        : undefined;
    } catch {
      return undefined;
    }
  }

  async write(id: string, signedIn: SignedIn): Promise<void> {
    await this.#credential(id).set(JSON.stringify(signedIn));
  }

  async delete(id: string): Promise<void> {
    await this.#credential(id).delete();
  }

  #credential(id: string): PiecewiseCredential {
    const store = this.#store;
    return new PiecewiseCredential(
      (name) => ({
        getPassword: () => store.get(name),
        setPassword: (value) => store.set(name, value),
        deletePassword: () => store.delete(name),
      }),
      `${id}#sign-in`,
    );
  }
}
