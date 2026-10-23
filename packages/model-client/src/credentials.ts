/**
 * A provider's key for one of its platforms: read here from the environment
 * or the operating system's credential store, and written only to the store.
 * Elsewhere it is sent only as the credential of a request to its lab, a
 * bearer token or the header the lab names, and looked for only to hide it
 * where the lab quotes it back.
 */

import type { ProviderSettings } from "@zhiyin/contract";
import {
  keyringEntries,
  PiecewiseCredential,
  type CredentialEntries,
} from "@zhiyin/credential-store";
import { ModelClientError } from "./failures.js";

export type { CredentialEntry } from "@zhiyin/credential-store";

export type ProviderCredentialsOptions = {
  readonly environment: () => string | undefined;
  /** The credential store's entries, by name; Windows' when absent. */
  readonly entries?: CredentialEntries;
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
  /** Kept in pieces when longer than one entry holds. */
  readonly #stored: PiecewiseCredential;
  readonly #keyName: string;

  constructor(options: ProviderCredentialsOptions) {
    this.#environment = options.environment;
    this.#stored = new PiecewiseCredential(
      options.entries ?? keyringEntries(),
      options.account ?? "openrouter",
    );
    this.#keyName = options.keyName ?? "an OpenRouter API key";
  }

  async get(): Promise<string | undefined> {
    const environment = this.#environment()?.trim();
    if (environment) return environment;
    try {
      return await this.#stored.get();
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
      const password = await this.#stored.get();
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
      await this.#stored.set(value);
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
      await this.#stored.delete();
    } catch (error) {
      throw new ModelClientError(
        "credentialUnavailable",
        "Secure key storage is unavailable.",
        { cause: error },
      );
    }
  }
}
