/**
 * A provider's key for one of its platforms: read from the environment or the
 * operating system's credential store, and written only to the store. The key itself never
 * leaves this module except as a request's bearer token.
 */

import type { ProviderSettings } from "@zhiyin/contract";
import { ModelClientError } from "./failures.js";

export type CredentialEntry = {
  getPassword(): Promise<string | undefined>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
};

export type ProviderCredentialsOptions = {
  readonly environment: () => string | undefined;
  readonly entry?: CredentialEntry;
  /**
   * The name the key is stored under. OpenRouter's is `openrouter`, where it
   * was kept before there were other providers.
   */
  readonly account?: string;
  /** The key as the person is asked for it. */
  readonly keyName?: string;
};

export class ProviderCredentials {
  readonly #environment: ProviderCredentialsOptions["environment"];
  readonly #providedEntry: CredentialEntry | undefined;
  readonly #account: string;
  readonly #keyName: string;
  #loadedEntry: Promise<CredentialEntry> | undefined;

  constructor(options: ProviderCredentialsOptions) {
    this.#environment = options.environment;
    this.#providedEntry = options.entry;
    this.#account = options.account ?? "openrouter";
    this.#keyName = options.keyName ?? "an OpenRouter API key";
  }

  async get(): Promise<string | undefined> {
    const environment = this.#environment()?.trim();
    if (environment) return environment;
    try {
      return await (await this.#entry()).getPassword();
    } catch (error) {
      throw new ModelClientError(
        "credentialUnavailable",
        "Secure key storage is unavailable.",
        { cause: error },
      );
    }
  }

  async status(): Promise<ProviderSettings["credential"]> {
    if (this.#environment()?.trim()) {
      return { status: "configured", source: "environment" };
    }
    try {
      const password = await (await this.#entry()).getPassword();
      return password
        ? { status: "configured", source: "credentialStore" }
        : { status: "missing", source: "none" };
    } catch {
      return {
        status: "unavailable",
        source: "credentialStore",
        reason: "Secure key storage is unavailable.",
      };
    }
  }

  async set(apiKey: string): Promise<void> {
    const value = apiKey.trim();
    if (!value) {
      throw new ModelClientError(
        "missingCredential",
        `Enter ${this.#keyName} before saving.`,
      );
    }
    try {
      await (await this.#entry()).setPassword(value);
    } catch (error) {
      throw new ModelClientError(
        "credentialUnavailable",
        "Secure key storage is unavailable.",
        { cause: error },
      );
    }
  }

  async clear(): Promise<void> {
    try {
      await (await this.#entry()).deletePassword();
    } catch (error) {
      throw new ModelClientError(
        "credentialUnavailable",
        "Secure key storage is unavailable.",
        { cause: error },
      );
    }
  }

  async #entry(): Promise<CredentialEntry> {
    if (this.#providedEntry) return this.#providedEntry;
    this.#loadedEntry ??= import("@napi-rs/keyring").then(
      ({ AsyncEntry }) => new AsyncEntry("Zhiyin", this.#account),
    );
    return this.#loadedEntry;
  }
}
