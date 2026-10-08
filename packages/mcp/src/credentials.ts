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
  readonly #entries = new Map<
    string,
    Promise<{
      getPassword(): Promise<string | undefined>;
      setPassword(password: string): Promise<void>;
      deletePassword(): Promise<boolean>;
    }>
  >();

  #entry(id: string) {
    let entry = this.#entries.get(id);
    if (!entry) {
      entry = import("@napi-rs/keyring").then(
        ({ AsyncEntry }) => new AsyncEntry("Zhiyin", `mcp:${id}`),
      );
      this.#entries.set(id, entry);
    }
    return entry;
  }

  async get(id: string) {
    return (await this.#entry(id)).getPassword();
  }
  async set(id: string, token: string) {
    await (await this.#entry(id)).setPassword(token);
  }
  async delete(id: string) {
    await (await this.#entry(id)).deletePassword();
  }
}
