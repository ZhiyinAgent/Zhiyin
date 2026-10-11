/**
 * A Mistral account: a key checked against Mistral's model listing, which
 * spends nothing, before it is kept, and the models it can use, from the
 * list shipped with the app and that listing.
 */

import { describe, expect, it } from "vitest";
import { ProviderCredentials } from "../../../credentials.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { mistral } from "../provider.js";

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
  const client = new ProviderModelClient(mistral, {
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

const models = "https://api.mistral.ai/v1/models";

/** A model card as Mistral's API reference lists its fields. */
function card(id: string, aliases: readonly string[] = []) {
  return {
    id,
    object: "model",
    owned_by: "mistralai",
    capabilities: { completion_chat: true, function_calling: true },
    max_context_length: 32_768,
    aliases,
    type: "base",
  };
}

describe("a Mistral key", () => {
  it("is checked against Mistral's model listing, which spends nothing, before it is kept", async () => {
    const asked: { url: string; key: string | undefined }[] = [];
    const { client, stored } = accountWith(
      answering(
        { [models]: { status: 200, body: { object: "list", data: [] } } },
        asked,
      ),
    );

    await client.setApiKey("mistral-good");

    expect(asked).toEqual([{ url: models, key: "Bearer mistral-good" }]);
    expect(stored()).toBe("mistral-good");
  });

  it("is never kept when Mistral rejects it", async () => {
    const { client, stored } = accountWith(
      answering({ [models]: { status: 401 } }),
    );

    await expect(client.setApiKey("mistral-wrong")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(stored()).toBeUndefined();
  });
});

describe("the Mistral models offered", () => {
  it("are the shipped ones Mistral still lists, by id or by alias, priced in US dollars", async () => {
    const { client } = accountWith(
      answering({
        [models]: {
          status: 200,
          body: {
            object: "list",
            data: [
              card("an-id-the-alias-points-to", [
                "mistral-medium-3-5",
                "mistral-medium-latest",
              ]),
              card("mistral-small-latest"),
            ],
          },
        },
      }),
    );

    expect(await client.models()).toEqual({
      status: "ready",
      models: [
        {
          id: "mistral-medium-3-5",
          name: "Mistral Medium 3.5",
          contextWindow: 256_000,
          acceptsImages: true,
          reasoning: true,
          price: {
            currency: "USD",
            input: 1.5,
            cacheRead: 0.15,
            output: 7.5,
            checked: "2026-10-09",
          },
        },
      ],
    });
  });

  it("are read from a listing given as a bare list of cards, as the API reference's example shows it", async () => {
    const { client } = accountWith(
      answering({
        [models]: { status: 200, body: [card("mistral-large-4")] },
      }),
    );

    const catalog = await client.models();

    expect(
      catalog.status === "ready" && catalog.models.map((model) => model.id),
    ).toEqual(["mistral-large-4"]);
  });

  it("are every shipped one when Mistral's listing cannot be read", async () => {
    const { client } = accountWith(answering({}));

    const catalog = await client.models();

    expect(
      catalog.status === "ready" && catalog.models.map((model) => model.id),
    ).toEqual(["mistral-large-4", "mistral-medium-3-5"]);
  });
});

describe("Mistral's settings", () => {
  it("say earlier turns go back with their reasoning, and give the window but no longest reply, which Mistral does not state", async () => {
    const client = new ProviderModelClient(mistral, {
      model: "mistral-large-4",
      apiKey: async () => "mistral-test-key",
      catalogFetch: answering({}),
      modelInfo: (model) => mistral.describe(model, {}),
    });

    const settings = await client.settings();

    expect(settings).toMatchObject({
      model: "mistral-large-4",
      contextWindow: 1_000_000,
      acceptsImages: true,
      reasoningSentBack: true,
      endpoint: "https://api.mistral.ai/v1/chat/completions",
      reasoning: {
        status: "available",
        required: false,
        efforts: ["high"],
      },
    });
    expect(settings).not.toHaveProperty("maximumOutputTokens");
  });
});
