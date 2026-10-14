/**
 * A Qwen account: a key checked with the platform it was issued by before it
 * is kept, and the models it offers, from the list shipped with the app.
 * Neither QwenCloud nor 千问云 documents a balance or model listing for an
 * API key (checked 2026-10-09), so the cheapest request that proves a key is
 * one token from the cheapest model, with thinking off.
 */

import { describe, expect, it } from "vitest";
import { ProviderCredentials } from "../../../credentials.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { qwen } from "../provider.js";

type Asked = {
  readonly url: string;
  readonly method: string | undefined;
  readonly key: string | undefined;
  readonly body: unknown;
};

function answering(status: number, asked: Asked[] = []): CatalogFetch {
  return async (url, init) => {
    asked.push({
      url,
      method: init.method,
      key: init.headers["Authorization"],
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () =>
        status === 401
          ? {
              error: {
                message: "Incorrect API key provided.",
                type: "invalid_request_error",
                code: "invalid_api_key",
              },
            }
          : {},
    };
  };
}

function accountWith(
  catalogFetch: CatalogFetch,
  region: "international" | "mainland" = "international",
) {
  let stored: string | undefined;
  const client = new ProviderModelClient(qwen, {
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

describe("a Qwen key", () => {
  it("is checked with one token from the cheapest model on the platform that issued it, before it is kept", async () => {
    const asked: Asked[] = [];
    const { client, stored } = accountWith(answering(200, asked), "mainland");

    await client.setApiKey("sk-ws-good");

    expect(asked).toEqual([
      {
        url: "https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions",
        method: "POST",
        key: "Bearer sk-ws-good",
        body: {
          model: "qwen3.8-flash",
          messages: [{ role: "user", content: "Hi" }],
          max_completion_tokens: 1,
          enable_thinking: false,
        },
      },
    ]);
    expect(stored()).toBe("sk-ws-good");
  });

  it("is never kept when Qwen rejects it", async () => {
    const { client, stored } = accountWith(answering(401));

    await expect(client.setApiKey("sk-ws-wrong")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(stored()).toBeUndefined();
  });

  it("is kept, with the trouble named, when the check could not say anything about the key", async () => {
    const { client, stored } = accountWith(answering(500));

    await expect(client.setApiKey("sk-ws-maybe")).resolves.toEqual({
      status: "unverified",
      reason: expect.stringContaining("could not be checked"),
    });
    expect(stored()).toBe("sk-ws-maybe");
  });
});

describe("the Qwen models offered", () => {
  it("are the shipped ones, priced on the account's platform in its currency", async () => {
    const { client } = accountWith(answering(404), "mainland");

    expect(await client.models()).toEqual({
      status: "ready",
      models: [
        expect.objectContaining({
          id: "qwen3.8-max",
          name: "Qwen3.8-Max",
          contextWindow: 1_000_000,
          acceptsImages: true,
          reasoning: true,
          price: expect.objectContaining({
            currency: "CNY",
            input: 12,
            cacheRead: 1.5,
            output: 36,
            checked: "2026-10-09",
          }),
        }),
        expect.objectContaining({
          id: "qwen3.8-flash",
          name: "Qwen3.8-Flash",
          price: expect.objectContaining({
            currency: "CNY",
            input: 0.8,
            cacheRead: 0.1,
            output: 2.7,
          }),
        }),
      ],
    });
  });
});

describe("Qwen's settings", () => {
  it("say earlier turns go back with their reasoning, so it counts toward a request's size", async () => {
    const client = new ProviderModelClient(qwen, {
      region: "international",
      model: "qwen3.8-flash",
      apiKey: async () => "sk-ws-test",
      catalogFetch: answering(404),
      modelInfo: (model) => qwen.describe(model, { region: "international" }),
    });

    expect(await client.settings()).toMatchObject({
      model: "qwen3.8-flash",
      contextWindow: 1_000_000,
      maximumOutputTokens: 128_000,
      reasoningSentBack: true,
      endpoint:
        "https://maas.qwencloudapi.com/compatible-mode/v1/chat/completions",
      reasoning: {
        status: "available",
        required: false,
        defaultEnabled: true,
        defaultEffort: "xhigh",
        efforts: ["low", "medium", "xhigh"],
      },
    });
  });
});
