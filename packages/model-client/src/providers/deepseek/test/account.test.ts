/**
 * A DeepSeek account: a key checked against its balance before it is kept,
 * and the models it can use, from the list shipped with the app and DeepSeek's
 * own listing.
 */

import { describe, expect, it } from "vitest";
import { ProviderCredentials } from "../../../credentials.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { deepSeek } from "../provider.js";

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
  const client = new ProviderModelClient(deepSeek, {
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

/** An account billed in US dollars, as International accounts are. */
const balance = {
  is_available: true,
  balance_infos: [{ currency: "USD", total_balance: "10.00" }],
};

const balanceIn = (currency: string) => ({
  "https://api.deepseek.com/user/balance": {
    status: 200,
    body: {
      is_available: true,
      balance_infos: [{ currency, total_balance: "10.00" }],
    },
  },
});

describe("a DeepSeek key", () => {
  it("is checked against the account's balance, which spends nothing, before it is kept", async () => {
    const asked: { url: string; key: string | undefined }[] = [];
    const { client, stored } = accountWith(
      answering(
        {
          "https://api.deepseek.com/user/balance": {
            status: 200,
            body: balance,
          },
        },
        asked,
      ),
    );

    await client.setApiKey("sk-good");

    expect(asked).toEqual([
      { url: "https://api.deepseek.com/user/balance", key: "Bearer sk-good" },
    ]);
    expect(stored()).toBe("sk-good");
  });

  // One host serves both platforms, so only the account's currency tells
  // which one it is on; a key on the other would be priced in the wrong one.
  it("is refused on the platform that does not bill the account's currency, naming the one that does", async () => {
    const dollars = accountWith(answering(balanceIn("USD")), "mainland");
    await expect(dollars.client.setApiKey("sk-usd")).rejects.toThrow(
      "This DeepSeek account is billed in US dollars. Choose International, then add the key there.",
    );
    expect(dollars.stored()).toBeUndefined();

    const yuan = accountWith(answering(balanceIn("CNY")), "international");
    await expect(yuan.client.setApiKey("sk-cny")).rejects.toThrow(
      "This DeepSeek account is billed in yuan. Choose Mainland China, then add the key there.",
    );
    expect(yuan.stored()).toBeUndefined();
  });

  it("is kept on the platform that bills the account's currency, or when the balance names none", async () => {
    const yuan = accountWith(answering(balanceIn("CNY")), "mainland");
    await yuan.client.setApiKey("sk-cny");
    expect(yuan.stored()).toBe("sk-cny");

    const unnamed = accountWith(
      answering({
        "https://api.deepseek.com/user/balance": {
          status: 200,
          body: { is_available: false, balance_infos: [] },
        },
      }),
      "mainland",
    );
    await unnamed.client.setApiKey("sk-new");
    expect(unnamed.stored()).toBe("sk-new");
  });

  it("is never kept when DeepSeek rejects it", async () => {
    const { client, stored } = accountWith(
      answering({ "https://api.deepseek.com/user/balance": { status: 401 } }),
    );

    await expect(client.setApiKey("sk-wrong")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(stored()).toBeUndefined();
  });
});

describe("the DeepSeek models offered", () => {
  const listing = {
    object: "list",
    data: [{ id: "deepseek-flash", object: "model", owned_by: "deepseek" }],
  };

  it("are the shipped ones DeepSeek still lists, priced on the account's platform", async () => {
    const { client } = accountWith(
      answering({
        "https://api.deepseek.com/models": { status: 200, body: listing },
      }),
      "mainland",
    );

    expect(await client.models()).toEqual({
      status: "ready",
      models: [
        {
          id: "deepseek-flash",
          name: "DeepSeek V4.1 Flash",
          contextWindow: 1_048_576,
          acceptsImages: true,
          reasoning: true,
          price: expect.objectContaining({
            currency: "CNY",
            input: 1,
            cacheRead: 0.02,
            output: 4,
            checked: "2026-10-09",
          }),
        },
      ],
    });
  });

  it("are every shipped one when DeepSeek's listing cannot be read", async () => {
    const { client } = accountWith(answering({}));

    const catalog = await client.models();

    expect(
      catalog.status === "ready" && catalog.models.map((model) => model.id),
    ).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
  });
});

describe("DeepSeek's settings", () => {
  it("say earlier turns go back with their reasoning, so it counts toward a request's size", async () => {
    const client = new ProviderModelClient(deepSeek, {
      region: "international",
      model: "deepseek-v4-pro",
      apiKey: async () => "sk-test",
      catalogFetch: answering({}),
      modelInfo: (model) =>
        deepSeek.describe(model, { region: "international" }),
    });

    expect(await client.settings()).toMatchObject({
      model: "deepseek-v4-pro",
      contextWindow: 1_048_576,
      maximumOutputTokens: 393_216,
      reasoningSentBack: true,
      endpoint: "https://api.deepseek.com/chat/completions",
    });
  });
});
