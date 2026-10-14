/**
 * A Moonshot account: a key checked against its balance on its own platform
 * before it is kept, and the models it can use, from the list shipped with
 * the app and Moonshot's own listing. A key from one platform is refused by
 * the other (Kimi API documentation, checked 2026-10-09).
 */

import { describe, expect, it } from "vitest";
import { ProviderCredentials } from "../../../credentials.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { moonshot } from "../provider.js";

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
  const client = new ProviderModelClient(moonshot, {
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

const balance = {
  code: 0,
  data: {
    available_balance: 49.58894,
    voucher_balance: 46.58893,
    cash_balance: 3.00001,
  },
  scode: "0x0",
  status: true,
};

describe("a Moonshot key", () => {
  it("is checked against the balance on the platform it is for, which spends nothing, before it is kept", async () => {
    const asked: { url: string; key: string | undefined }[] = [];
    const routes = {
      "https://api.moonshot.ai/v1/users/me/balance": {
        status: 200,
        body: balance,
      },
      "https://api.moonshot.cn/v1/users/me/balance": {
        status: 200,
        body: balance,
      },
    };
    const international = accountWith(answering(routes, asked));
    const mainland = accountWith(answering(routes, asked), "mainland");

    await international.client.setApiKey("sk-international");
    await mainland.client.setApiKey("sk-mainland");

    expect(asked).toEqual([
      {
        url: "https://api.moonshot.ai/v1/users/me/balance",
        key: "Bearer sk-international",
      },
      {
        url: "https://api.moonshot.cn/v1/users/me/balance",
        key: "Bearer sk-mainland",
      },
    ]);
    expect([international.stored(), mainland.stored()]).toEqual([
      "sk-international",
      "sk-mainland",
    ]);
  });

  it("is never kept when its platform rejects it, and the person is told a key works only where it was made", async () => {
    const { client, stored } = accountWith(
      answering({
        "https://api.moonshot.cn/v1/users/me/balance": { status: 401 },
      }),
      "mainland",
    );

    await expect(
      client.setApiKey("sk-from-the-other-platform"),
    ).rejects.toMatchObject({
      code: "unauthorized",
      message: expect.stringContaining(
        "a key works only on the platform it was made on",
      ),
    });
    expect(stored()).toBeUndefined();
  });

  it("is kept, and said to be unchecked, when the platform will not show this computer the balance", async () => {
    const { client, stored } = accountWith(
      answering({
        "https://api.moonshot.ai/v1/users/me/balance": {
          status: 403,
          body: {
            error: {
              type: "permission_denied_error",
              message: "Your IP is not allowed to access this organization",
            },
          },
        },
      }),
    );

    await expect(client.setApiKey("sk-good")).resolves.toEqual({
      status: "unverified",
      reason: expect.stringContaining("could not be checked"),
    });
    expect(stored()).toBe("sk-good");
  });
});

describe("the Moonshot models offered", () => {
  const listing = {
    object: "list",
    data: [
      {
        id: "kimi-k2.6",
        object: "model",
        created: 123,
        owned_by: "moonshot",
        context_length: 262_144,
        supports_image_in: true,
        supports_video_in: true,
        supports_reasoning: true,
      },
    ],
  };

  it("are the shipped ones the platform still lists, priced in that platform's currency", async () => {
    const asked: { url: string; key: string | undefined }[] = [];
    const { client } = accountWith(
      answering(
        {
          "https://api.moonshot.cn/v1/models": { status: 200, body: listing },
        },
        asked,
      ),
      "mainland",
    );

    expect(await client.models()).toEqual({
      status: "ready",
      models: [
        {
          id: "kimi-k2.6",
          name: "Kimi K2.6",
          contextWindow: 262_144,
          acceptsImages: true,
          reasoning: true,
          price: expect.objectContaining({
            currency: "CNY",
            input: 6.5,
            cacheRead: 1.1,
            output: 27,
            checked: "2026-10-09",
          }),
        },
      ],
    });
    expect(asked.map(({ url }) => url)).toEqual([
      "https://api.moonshot.cn/v1/models",
    ]);
  });

  it("are every shipped one when the listing cannot be read", async () => {
    const { client } = accountWith(answering({}));

    const catalog = await client.models();

    expect(
      catalog.status === "ready" && catalog.models.map((model) => model.id),
    ).toEqual([
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.7-code-highspeed",
      "kimi-k2.6",
    ]);
  });
});

describe("Moonshot's settings", () => {
  it("say earlier turns go back with their reasoning, so it counts toward a request's size", async () => {
    const client = new ProviderModelClient(moonshot, {
      region: "mainland",
      model: "kimi-k3",
      apiKey: async () => "sk-test",
      catalogFetch: answering({}),
      modelInfo: (model) => moonshot.describe(model, { region: "mainland" }),
    });

    expect(await client.settings()).toMatchObject({
      model: "kimi-k3",
      contextWindow: 1_048_576,
      maximumOutputTokens: 1_048_576,
      acceptsImages: true,
      reasoningSentBack: true,
      endpoint: "https://api.moonshot.cn/v1/chat/completions",
    });
  });
});
