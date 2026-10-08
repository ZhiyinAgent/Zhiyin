/**
 * A key is checked before it is kept.
 *
 * Storing whatever was pasted turns one mistake at setup into a puzzle later:
 * the next request fails somewhere else, saying something else, and nothing
 * points back at the key. The catalogue cannot do this check - it answers a
 * rejected key normally - so the account endpoint is what has to be asked.
 * Verified against the live provider: `/api/v1/key` answers 401 to a rejected
 * key while `/api/v1/models` answers 200.
 */

import { describe, expect, it } from "vitest";
import {
  ModelClientError,
  OpenRouterModelClient,
  ProviderCredentials,
  type CatalogFetch,
} from "../src/index.js";

function storedKey() {
  let value: string | undefined;
  const entry = {
    getPassword: async () => value,
    setPassword: async (secret: string) => {
      value = secret;
    },
    deletePassword: async () => {
      value = undefined;
      return true;
    },
  };
  return {
    credentials: new ProviderCredentials({
      environment: () => undefined,
      entry,
    }),
    saved: () => value,
  };
}

function clientAnswering(
  status: number,
  body: unknown = {},
): {
  client: OpenRouterModelClient;
  saved: () => string | undefined;
  asked: string[];
} {
  const store = storedKey();
  const asked: string[] = [];
  const fetcher: CatalogFetch = async (url) => {
    asked.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return {
    client: new OpenRouterModelClient({
      credentials: store.credentials,
      catalogFetch: fetcher,
      model: "z-ai/glm-5.3-flash",
    }),
    saved: store.saved,
    asked,
  };
}

describe("saving a provider key", () => {
  it("keeps a key the provider accepts", async () => {
    const fixture = clientAnswering(200, { data: { label: "a key" } });

    await fixture.client.setApiKey("sk-or-v1-good");

    expect(fixture.saved()).toBe("sk-or-v1-good");
  });

  it("refuses a key the provider rejects, and stores nothing", async () => {
    const fixture = clientAnswering(401);

    await expect(
      fixture.client.setApiKey("sk-or-v1-bad"),
    ).rejects.toMatchObject({ code: "unauthorized" });

    expect(fixture.saved()).toBeUndefined();
  });

  it("does not replace a working key with a rejected one", async () => {
    const store = storedKey();
    let status = 200;
    const client = new OpenRouterModelClient({
      credentials: store.credentials,
      catalogFetch: async () => ({
        ok: status === 200,
        status,
        json: async () => ({}),
      }),
      model: "z-ai/glm-5.3-flash",
    });
    await client.setApiKey("sk-or-v1-good");

    status = 401;
    await expect(client.setApiKey("sk-or-v1-bad")).rejects.toBeInstanceOf(
      ModelClientError,
    );

    expect(store.saved()).toBe("sk-or-v1-good");
  });

  /**
   * Someone whose wifi is down has not typed the wrong key, and must not be
   * told they have. The key is kept and the trouble is named for what it is.
   */
  it("keeps a key it could not check, and says it could not check it", async () => {
    const store = storedKey();
    const client = new OpenRouterModelClient({
      credentials: store.credentials,
      catalogFetch: async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
      model: "z-ai/glm-5.3-flash",
    });

    await expect(client.setApiKey("sk-or-v1-unknown")).rejects.toMatchObject({
      code: "networkFailure",
    });
    expect(store.saved()).toBe("sk-or-v1-unknown");
  });

  it("asks the account endpoint, not the catalogue, because the catalogue answers anything", async () => {
    const fixture = clientAnswering(200, {});

    await fixture.client.setApiKey("sk-or-v1-good");

    expect(fixture.asked).toEqual(["https://openrouter.ai/api/v1/key"]);
  });
});
