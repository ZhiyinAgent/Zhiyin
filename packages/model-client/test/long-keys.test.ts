/**
 * A provider's key is kept in the Windows credential store, whose entries hold
 * at most 1,280 characters. A longer key is kept whole all the same, never
 * refused as if the store were unavailable.
 */

import { describe, expect, it } from "vitest";
import type { CredentialEntries } from "@zhiyin/credential-store";
import { ProviderCredentials } from "../src/credentials.js";

function limitedEntries(): CredentialEntries {
  const held = new Map<string, string>();
  return (name) => ({
    getPassword: async () => held.get(name),
    setPassword: async (value) => {
      if (value.length > 1280)
        throw new Error("Longer than the platform limit");
      held.set(name, value);
    },
    deletePassword: async () => held.delete(name),
  });
}

describe("a provider key longer than one credential entry holds", () => {
  it("is kept and read back whole", async () => {
    const credentials = new ProviderCredentials({
      environment: () => undefined,
      entries: limitedEntries(),
    });
    const key = `sk-${"k".repeat(2_000)}`;

    await credentials.set(key);

    expect(await credentials.get()).toBe(key);
    expect(await credentials.status()).toEqual({
      status: "configured",
      source: "credentialStore",
    });
  });
});
