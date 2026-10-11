/**
 * A MiniMax account: a key checked against the platform's model listing,
 * which spends nothing, before it is kept, and the models it can use, from
 * the list shipped with the app and MiniMax's own listing.
 */

import { describe, expect, it } from "vitest";
import { ProviderCredentials } from "../../../credentials.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { miniMax } from "../provider.js";

function answering(
  routes: Record<string, { status: number; body?: unknown }>,
  asked: { url: string; key: string | undefined }[] = [],
): CatalogFetch {
  return async (url, init) => {
    asked.push({ url, key: init.headers["Authorization"] });
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
  const client = new ProviderModelClient(miniMax, {
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

const listing = {
  data: [{ id: "MiniMax-M3", display_name: "MiniMax-M3", type: "model" }],
  has_more: false,
};

describe("a MiniMax key", () => {
  it("is checked against the model listing of the platform that issued it, before it is kept", async () => {
    const asked: { url: string; key: string | undefined }[] = [];
    const { client, stored } = accountWith(
      answering(
        {
          "https://api.minimax.cn/anthropic/v1/models": {
            status: 200,
            body: listing,
          },
        },
        asked,
      ),
      "mainland",
    );

    await client.setApiKey("sk-good");

    expect(asked).toEqual([
      {
        url: "https://api.minimax.cn/anthropic/v1/models",
        key: "Bearer sk-good",
      },
    ]);
    expect(stored()).toBe("sk-good");
  });

  it("is never kept when MiniMax rejects it", async () => {
    const { client, stored } = accountWith(
      answering({
        "https://api.minimax.io/anthropic/v1/models": { status: 401 },
      }),
    );

    await expect(client.setApiKey("sk-wrong")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(stored()).toBeUndefined();
  });
});

describe("the MiniMax models offered", () => {
  it("are the shipped ones MiniMax still lists, priced on the account's platform", async () => {
    const { client } = accountWith(
      answering({
        "https://api.minimax.cn/anthropic/v1/models": {
          status: 200,
          body: listing,
        },
      }),
      "mainland",
    );

    expect(await client.models()).toEqual({
      status: "ready",
      models: [
        expect.objectContaining({
          id: "MiniMax-M3",
          name: "MiniMax-M3",
          contextWindow: 1_000_000,
          // Documented as taking pictures, but checked live 2026-10-09 it
          // misread every one sent, by URL or in the request.
          acceptsImages: false,
          reasoning: true,
          price: expect.objectContaining({
            currency: "CNY",
            input: 2.1,
            cacheRead: 0.42,
            output: 8.4,
            checked: "2026-10-09",
          }),
        }),
      ],
    });
  });

  it("are every shipped one when MiniMax's listing cannot be read", async () => {
    const { client } = accountWith(answering({}));

    const catalog = await client.models();

    expect(
      catalog.status === "ready" && catalog.models.map((model) => model.id),
    ).toEqual(["MiniMax-M3", "MiniMax-M2.7"]);
  });
});

describe("MiniMax's settings", () => {
  it("say earlier turns go back with their reasoning, so it counts toward a request's size", async () => {
    const client = new ProviderModelClient(miniMax, {
      region: "international",
      model: "MiniMax-M2.7",
      apiKey: async () => "sk-test",
      catalogFetch: answering({}),
      modelInfo: (model) =>
        miniMax.describe(model, { region: "international" }),
    });

    expect(await client.settings()).toMatchObject({
      model: "MiniMax-M2.7",
      contextWindow: 204_800,
      maximumOutputTokens: 65_536,
      acceptsImages: false,
      reasoningSentBack: true,
      endpoint: "https://api.minimax.io/anthropic/v1/messages",
      reasoning: {
        status: "available",
        required: true,
        defaultEnabled: true,
        efforts: [],
      },
    });
  });
});
