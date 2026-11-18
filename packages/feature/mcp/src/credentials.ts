import { keyringEntries } from "@zhiyin/credential-store";

/**
 * Where access tokens live. Only this holds a token; definitions, snapshots,
 * and evidence never do.
 */
export interface McpCredentialStore {
  get(id: string): Promise<string | undefined>;
  set(id: string, token: string): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Tokens for the life of the process. Suitable for tests and headless use. */
export class InMemoryMcpCredentials implements McpCredentialStore {
  readonly #tokens = new Map<string, string>();
  async get(id: string) {
    return this.#tokens.get(id);
  }
  async set(id: string, token: string) {
    this.#tokens.set(id, token);
  }
  async delete(id: string) {
    this.#tokens.delete(id);
  }
}

/** Tokens in the operating system credential store, one entry per server. */
export class KeyringMcpCredentials implements McpCredentialStore {
  readonly #entries = keyringEntries();

  async get(id: string) {
    return this.#entries(`mcp:${id}`).getPassword();
  }
  async set(id: string, token: string) {
    await this.#entries(`mcp:${id}`).setPassword(token);
  }
  async delete(id: string) {
    await this.#entries(`mcp:${id}`).deletePassword();
  }
}
