/**
 * An OpenAI account: a key checked against OpenAI's model listing before it
 * is kept, and the models it can use, from the list shipped with the app and
 * OpenAI's own listing.
 */

import { describe, expect, it } from "vitest";
import { ProviderCredentials } from "../../../credentials.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { openAi } from "../provider.js";

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

function accountWith(catalogFetch: CatalogFetch) {
  let stored: string | undefined;
  const client = new ProviderModelClient(openAi, {
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

const models = "https://api.openai.com/v1/models";

const listing = {
  object: "list",
  data: [
    {
      id: "gpt-6.1-sol",
      object: "model",
      created: 1_780_000_000,
      owned_by: "openai",
      shutdown_date: null,
    },
    {
      id: "gpt-6-luna",
      object: "model",
      created: 1_780_000_000,
      owned_by: "openai",
      shutdown_date: null,
    },
  ],
};

describe("an OpenAI key", () => {
  it("is checked against OpenAI's model listing, which spends nothing, before it is kept", async () => {
    const asked: { url: string; key: string | undefined }[] = [];
    const { client, stored } = accountWith(
      answering({ [models]: { status: 200, body: listing } }, asked),
    );

    await client.setApiKey("sk-good");

    expect(asked).toEqual([{ url: models, key: "Bearer sk-good" }]);
    expect(stored()).toBe("sk-good");
  });

  it("is never kept when OpenAI rejects it", async () => {
    const { client, stored } = accountWith(
      answering({
        [models]: {
          status: 401,
          body: { error: { message: "Incorrect API key provided." } },
        },
      }),
    );

    await expect(client.setApiKey("sk-wrong")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(stored()).toBeUndefined();
  });

  it("is never kept when OpenAI refuses the request for another reason, which is said in OpenAI's words", async () => {
    const { client, stored } = accountWith(
      answering({
        [models]: {
          status: 403,
          body: {
            error: { message: "Country, region, or territory not supported" },
          },
        },
      }),
    );

    await expect(client.setApiKey("sk-good")).rejects.toMatchObject({
      code: "requestRejected",
      message:
        "OpenAI refused the request: Country, region, or territory not supported",
    });
    expect(stored()).toBeUndefined();
  });
});

describe("the OpenAI models offered", () => {
  it("are the shipped ones OpenAI still lists, each with its window and Standard price", async () => {
    const { client } = accountWith(
      answering({ [models]: { status: 200, body: listing } }),
    );

    expect(await client.models()).toEqual({
      status: "ready",
      models: [
        {
          id: "gpt-6.1-sol",
          name: "GPT-6.1 Sol",
          contextWindow: 1_050_000,
          acceptsImages: true,
          reasoning: true,
          price: {
            currency: "USD",
            input: 2,
            cacheRead: 0.1,
            cacheWrite: 2.5,
            output: 10,
            tiers: [
              {
                aboveInputTokens: 272_000,
                input: 4,
                cacheRead: 0.2,
                cacheWrite: 5,
                output: 15,
              },
            ],
            checked: "2026-10-09",
          },
        },
        {
          id: "gpt-6-luna",
          name: "GPT-6 Luna",
          contextWindow: 1_050_000,
          acceptsImages: true,
          reasoning: true,
          price: expect.objectContaining({
            input: 0.1,
            cacheRead: 0.01,
            cacheWrite: 0.125,
            output: 0.5,
          }),
        },
      ],
    });
  });

  it("are every shipped one when OpenAI's listing cannot be read", async () => {
    const { client } = accountWith(answering({}));

    const catalog = await client.models();

    expect(
      catalog.status === "ready" && catalog.models.map((model) => model.id),
    ).toEqual(["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]);
  });
});

describe("OpenAI's settings", () => {
  it("give the model's window and longest reply, and the reasoning controls each model offers", async () => {
    const settingsOf = (model: string) =>
      new ProviderModelClient(openAi, {
        model,
        apiKey: async () => "sk-test",
        catalogFetch: answering({}),
        modelInfo: (id) => openAi.describe(id, {}),
      }).settings();

    expect(await settingsOf("gpt-6-astra")).toMatchObject({
      model: "gpt-6-astra",
      contextWindow: 1_050_000,
      maximumOutputTokens: 128_000,
      acceptsImages: true,
      endpoint: "https://api.openai.com/v1/responses",
      reasoning: {
        status: "available",
        required: true,
        efforts: ["low", "medium", "high", "xhigh", "max"],
      },
    });
    expect((await settingsOf("gpt-6-astra")).reasoning).not.toHaveProperty(
      "defaultEffort",
    );
    expect((await settingsOf("gpt-6.1-sol")).reasoning).toEqual({
      status: "available",
      required: true,
      defaultEnabled: true,
      defaultEffort: "medium",
      efforts: ["low", "medium", "high", "xhigh", "max"],
    });
    expect((await settingsOf("gpt-6-luna")).reasoning).toEqual({
      status: "available",
      required: false,
      defaultEnabled: true,
      defaultEffort: "medium",
      efforts: ["low", "medium", "high", "xhigh", "max"],
    });
  });

  it("do not count earlier reasoning as sent back: what goes back is OpenAI's own sealed record, not the readable summary", async () => {
    const settings = await new ProviderModelClient(openAi, {
      model: "gpt-6.1-sol",
      apiKey: async () => "sk-test",
      catalogFetch: answering({}),
      modelInfo: (id) => openAi.describe(id, {}),
    }).settings();

    expect(settings).not.toHaveProperty("reasoningSentBack");
  });
});
