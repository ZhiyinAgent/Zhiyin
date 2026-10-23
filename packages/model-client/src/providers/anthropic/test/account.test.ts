/**
 * An Anthropic account: a key checked against the model listing before it is
 * kept, and the Claude models it can use, from the list shipped with the app
 * and Anthropic's own listing (Models API reference, checked 2026-10-09).
 */

import { describe, expect, it } from "vitest";
import { ProviderCredentials } from "../../../credentials.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { anthropic } from "../../../../test/shipped-providers.js";

type Asked = {
  url: string;
  headers: Readonly<Record<string, string>>;
};

function answering(
  routes: Record<string, { status: number; body?: unknown }>,
  asked: Asked[] = [],
): CatalogFetch {
  return async (url, init) => {
    asked.push({ url, headers: init.headers });
    const route = routes[url] ?? { status: 404 };
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.body ?? {},
    };
  };
}

function accountWith(catalogFetch: CatalogFetch, model?: string) {
  let stored: string | undefined;
  const client = new ProviderModelClient(anthropic, {
    catalogFetch,
    ...(model
      ? { model, modelInfo: (id: string) => anthropic.describe(id, {}) }
      : {}),
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
  return { client, stored: () => stored };
}

const listing = {
  data: [
    {
      type: "model",
      id: "claude-sonnet-5-5",
      display_name: "Claude Sonnet 5.5",
    },
    { type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
    { type: "model", id: "claude-opus-5", display_name: "Claude Opus 5" },
  ],
  has_more: false,
};

describe("an Anthropic key", () => {
  it("is checked against the model listing, which spends nothing, before it is kept", async () => {
    const asked: Asked[] = [];
    const { client, stored } = accountWith(
      answering(
        {
          "https://api.anthropic.com/v1/models?limit=1": {
            status: 200,
            body: listing,
          },
        },
        asked,
      ),
    );

    await client.setApiKey("sk-ant-good");

    expect(asked).toEqual([
      {
        url: "https://api.anthropic.com/v1/models?limit=1",
        headers: {
          Authorization: "Bearer sk-ant-good",
          "anthropic-version": "2023-06-01",
        },
      },
    ]);
    expect(stored()).toBe("sk-ant-good");
  });

  it("is never kept when Anthropic rejects it", async () => {
    for (const status of [401, 403]) {
      const { client, stored } = accountWith(
        answering({
          "https://api.anthropic.com/v1/models?limit=1": { status },
        }),
      );

      await expect(client.setApiKey("sk-ant-wrong")).rejects.toMatchObject({
        code: "unauthorized",
      });
      expect(stored()).toBeUndefined();
    }
  });
});

describe("the Claude models offered", () => {
  it("are the shipped ones Anthropic still lists, priced in US dollars", async () => {
    const { client } = accountWith(
      answering({
        "https://api.anthropic.com/v1/models?limit=1000": {
          status: 200,
          body: listing,
        },
      }),
    );

    const catalog = await client.models();

    expect(catalog).toEqual({
      status: "ready",
      models: [
        {
          id: "claude-opus-5-5",
          name: "Claude Opus 5.5",
          contextWindow: 1_000_000,
          acceptsImages: true,
          reasoning: true,
          price: {
            currency: "USD",
            input: 4,
            cacheRead: 0.2,
            cacheWrite: 5,
            output: 20,
            checked: "2026-10-09",
          },
        },
        expect.objectContaining({
          id: "claude-sonnet-5-5",
          name: "Claude Sonnet 5.5",
        }),
      ],
    });
  });

  it("are every shipped one when Anthropic's listing cannot be read", async () => {
    const { client } = accountWith(answering({}));

    const catalog = await client.models();

    expect(
      catalog.status === "ready" && catalog.models.map((model) => model.id),
    ).toEqual([
      "claude-fable-5-1",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
  });
});

describe("Anthropic's settings", () => {
  it("say earlier turns go back with their thinking, with the window and longest reply Anthropic states", async () => {
    const { client } = accountWith(answering({}), "claude-sonnet-5-5");

    expect(await client.settings()).toMatchObject({
      model: "claude-sonnet-5-5",
      contextWindow: 1_000_000,
      maximumOutputTokens: 128_000,
      acceptsImages: true,
      reasoningSentBack: true,
      endpoint: "https://api.anthropic.com/v1/messages",
    });
  });

  it("offer every effort on each model, with its own default, and thinking that cannot be turned off on Opus 5.5 and Fable 5.1", async () => {
    const efforts = ["low", "medium", "high", "xhigh", "max"];
    const controls = async (model: string) =>
      (await accountWith(answering({}), model).client.settings()).reasoning;

    expect(await controls("claude-fable-5-1")).toEqual({
      status: "available",
      required: true,
      defaultEnabled: true,
      defaultEffort: "high",
      efforts,
    });
    expect(await controls("claude-opus-5-5")).toEqual({
      status: "available",
      required: true,
      defaultEnabled: true,
      defaultEffort: "medium",
      efforts,
    });
    expect(await controls("claude-sonnet-5-5")).toEqual({
      status: "available",
      required: false,
      defaultEnabled: true,
      defaultEffort: "high",
      efforts,
    });
    expect(await controls("claude-haiku-5-5")).toEqual({
      status: "available",
      required: false,
      defaultEnabled: true,
      defaultEffort: "medium",
      efforts,
    });
  });
});
