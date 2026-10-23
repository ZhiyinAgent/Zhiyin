import { describe, expect, it } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import { ProviderCredentials } from "../src/credentials.js";
import { everyProvider } from "./shipped-providers.js";

/**
 * A provider that is busy, or failing on its own side, when a key is checked
 * has said nothing about the key. The key is kept and said to be unchecked,
 * so the person is not told a good key is wrong.
 */
const platforms = everyProvider.flatMap((provider) =>
  (provider.regions ?? [undefined]).map(
    (region) =>
      [
        region ? `${provider.name}, ${region.name}` : provider.name,
        provider,
        region?.id,
      ] as const,
  ),
);

describe.each(platforms)(
  "%s, busy when a key is checked",
  (_name, provider, region) => {
    it.each([429, 500, 503])(
      "keeps the key, unchecked, when the check is answered %i",
      async (status) => {
        let stored: string | undefined;
        const client = new ProviderModelClient(provider, {
          ...(region ? { region } : {}),
          catalogFetch: async () => ({
            ok: false,
            status,
            json: async () => ({}),
          }),
          credentials: new ProviderCredentials({
            environment: () => undefined,
            entries: () => ({
              getPassword: async () => stored,
              setPassword: async (value) => {
                stored = value;
              },
              deletePassword: async () => true,
            }),
          }),
        });

        await expect(client.setApiKey("sk-maybe")).resolves.toEqual({
          status: "unverified",
          reason: expect.stringContaining("could not be checked"),
        });
        expect(stored).toBe("sk-maybe");
      },
    );
  },
);
