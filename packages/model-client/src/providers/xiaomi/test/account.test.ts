/**
 * A Xiaomi MiMo account: a key checked against Xiaomi's model listing before
 * it is kept, and the models it can use, from the list shipped with the app
 * and Xiaomi's own listing.
 */

import { describe, expect, it } from "vitest";
import { ProviderCredentials } from "../../../credentials.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { xiaomi } from "../provider.js";

function answering(
  routes: Record<string, { status: number; body?: unknown }>,
  asked: { url: string; key: string | undefined }[] = [],
): CatalogFetch {
  return async (url, init) => {
    asked.push({ url, key: init.headers["api-key"] });
    const route = routes[url] ?? { status: 404 };
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.body ?? {},
    };
  };
}

function accountWith(
  catalogFetch: CatalogFetch,
  region: "international" | "mainland" = "international",
) {
  let stored: string | undefined;
  const client = new ProviderModelClient(xiaomi, {
    region,
    catalogFetch,
    credentials: new ProviderCredentials({
      environment: () => undefined,
      entry: {
        getPassword: async () => stored,
        setPassword: async (value) => {
          stored = value;
        },
        deletePassword: async () => true,
      },
    }),
  });
  return { client, stored: () => stored };
}

/** Shaped like the List Models response in Xiaomi's API reference. */
const listing = {
  object: "list",
  data: [{ id: "mimo-v2.6-flash", object: "model", owned_by: "xiaomi" }],
};

describe("a Xiaomi MiMo key", () => {
  it("is checked against Xiaomi's model listing, which generates nothing, before it is kept", async () => {
    const asked: { url: string; key: string | undefined }[] = [];
    const { client, stored } = accountWith(
      answering(
        {
          "https://api.xiaomimimo.com/v1/models": {
            status: 200,
            body: listing,
          },
        },
        asked,
      ),
    );

    await client.setApiKey("sk-good");

    expect(asked).toEqual([
      { url: "https://api.xiaomimimo.com/v1/models", key: "sk-good" },
    ]);
    expect(stored()).toBe("sk-good");
  });

  it("is never kept when Xiaomi rejects it", async () => {
    const { client, stored } = accountWith(
      answering({ "https://api.xiaomimimo.com/v1/models": { status: 401 } }),
    );

    await expect(client.setApiKey("sk-wrong")).rejects.toMatchObject({
      code: "unauthorized",
      message: "Xiaomi MiMo rejected the API key.",
    });
    expect(stored()).toBeUndefined();
  });

  it("is never kept when Xiaomi refuses it for the region or its risk control", async () => {
    const { client, stored } = accountWith(
      answering({ "https://api.xiaomimimo.com/v1/models": { status: 403 } }),
    );

    await expect(client.setApiKey("sk-restricted")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(stored()).toBeUndefined();
  });
});

describe("the Xiaomi MiMo models offered", () => {
  it("are the shipped ones Xiaomi still lists, priced on the account's platform", async () => {
    const { client } = accountWith(
      answering({
        "https://api.xiaomimimo.com/v1/models": { status: 200, body: listing },
      }),
      "mainland",
    );

    expect(await client.models()).toEqual({
      status: "ready",
      models: [
        {
          id: "mimo-v2.6-flash",
          name: "MiMo-V2.6-Flash",
          contextWindow: 1_048_576,
          acceptsImages: true,
          reasoning: true,
          price: {
            currency: "CNY",
            input: 1,
            cacheRead: 0.02,
            output: 2,
            checked: "2026-10-09",
          },
        },
      ],
    });
  });

  it("are every shipped one when Xiaomi's listing cannot be read", async () => {
    const { client } = accountWith(answering({}));

    const catalog = await client.models();

    expect(
      catalog.status === "ready" && catalog.models.map((model) => model.id),
    ).toEqual(["mimo-v2.6-pro", "mimo-v2.6-flash"]);
  });
});

describe("Xiaomi MiMo's settings", () => {
  it("say earlier turns go back with their reasoning, so it counts toward a request's size", async () => {
    const client = new ProviderModelClient(xiaomi, {
      region: "international",
      model: "mimo-v2.6-pro",
      apiKey: async () => "sk-test",
      catalogFetch: answering({}),
      modelInfo: (model) => xiaomi.describe(model, { region: "international" }),
    });

    expect(await client.settings()).toMatchObject({
      model: "mimo-v2.6-pro",
      contextWindow: 1_048_576,
      maximumOutputTokens: 131_072,
      acceptsImages: true,
      reasoning: {
        status: "available",
        required: false,
        defaultEnabled: true,
        efforts: [],
      },
      reasoningSentBack: true,
      endpoint: "https://api.xiaomimimo.com/v1/chat/completions",
    });
  });
});
