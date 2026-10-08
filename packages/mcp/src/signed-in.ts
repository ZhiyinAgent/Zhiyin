/**
 * A connection's sign-in, kept in the credential store like a pasted key. It
 * is longer than one Windows credential entry holds (1,280 characters), so it
 * is written in pieces, the count last: a sign-in half written reads as none.
 */

import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import type { McpCredentialStore } from "./credentials.js";

export type SignedIn = {
  readonly tokens: OAuthTokens;
  /** When the tokens were issued, in milliseconds since the epoch. */
  readonly issuedAt: number;
  readonly client: OAuthClientInformationMixed;
  readonly authorizationServer: string;
  readonly metadata?: AuthorizationServerMetadata;
  readonly resource?: string;
};

const pieceLength = 1_200;

const countEntry = (id: string) => `${id}#sign-in`;
const pieceEntry = (id: string, index: number) =>
  `${id}#sign-in:${String(index)}`;

export class SignedInStore {
  readonly #store: McpCredentialStore;

  constructor(store: McpCredentialStore) {
    this.#store = store;
  }

  async read(id: string): Promise<SignedIn | undefined> {
    const count = Number(await this.#store.get(countEntry(id)));
    if (!Number.isInteger(count) || count < 1) return undefined;
    const pieces = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        this.#store.get(pieceEntry(id, index)),
      ),
    );
    if (pieces.some((piece) => piece === undefined)) return undefined;
    try {
      return JSON.parse(pieces.join("")) as SignedIn;
    } catch {
      return undefined;
    }
  }

  async write(id: string, signedIn: SignedIn): Promise<void> {
    await this.delete(id);
    const text = JSON.stringify(signedIn);
    const count = Math.ceil(text.length / pieceLength);
    for (let index = 0; index < count; index++)
      await this.#store.set(
        pieceEntry(id, index),
        text.slice(index * pieceLength, (index + 1) * pieceLength),
      );
    await this.#store.set(countEntry(id), String(count));
  }

  async delete(id: string): Promise<void> {
    const count = Number(await this.#store.get(countEntry(id)));
    await this.#store.delete(countEntry(id));
    if (!Number.isInteger(count)) return;
    for (let index = 0; index < count; index++)
      await this.#store.delete(pieceEntry(id, index));
  }
}
