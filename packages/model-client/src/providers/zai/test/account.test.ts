/**
 * A Z.ai account: a key checked before it is kept, and the models it can use,
 * from the list shipped with the app. Neither platform documents a models,
 * account or balance endpoint (API references, checked 2026-10-09), so a key
 * is checked with a one-token request to GLM-4.7-Flash, which both platforms
 * price as free, or GLM-5.3-Flash when that one is overloaded, and the shipped
 * list is the whole list.
 */

import { describe, expect, it } from "vitest";
import { ProviderCredentials } from "../../../credentials.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { zai } from "../provider.js";

type Asked = {
  readonly url: string;
  readonly method: string | undefined;
  readonly key: string | undefined;
  readonly body: unknown;
};

function answering(
  routes: Record<string, { status: number; body?: unknown }>,
  asked: Asked[] = [],
): CatalogFetch {
  return async (url, init) => {
    asked.push({
      url,
      method: init.method,
      key: init.headers["Authorization"],
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const route = routes[url] ?? { status: 404 };
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.body ?? {},
    };
  };
}

/** Z.ai's side of a key check, answering by the model asked for. */
function answeringByModel(
  byModel: Record<string, { status: number; body?: unknown }>,
  asked: Asked[] = [],
): CatalogFetch {
  return async (url, init) => {
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    asked.push({
      url,
      method: init.method,
      key: init.headers["Authorization"],
      body,
    });
    const route =
      byModel[(body as { model?: string } | undefined)?.model ?? ""];
    const answer = route ?? { status: 404 };
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body ?? {},
    };
  };
}

const overloaded = {
  error: {
    code: "1305",
    message:
      "The service may be temporarily overloaded, please try again later",
  },
};

function accountWith(
  catalogFetch: CatalogFetch,
  region: "international" | "mainland" = "international",
) {
  let stored: string | undefined;
  const client = new ProviderModelClient(zai, {
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

const international = "https://api.z.ai/api/paas/v4/chat/completions";
const mainland = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

const answered = {
  id: "check-1",
  model: "glm-4.7-flash",
  choices: [{ index: 0, finish_reason: "length", message: { content: "" } }],
};

describe("a Z.ai key", () => {
  it("is checked with a one-token request to a model priced as free, on the platform it is for, before it is kept", async () => {
    for (const [region, url] of [
      ["international", international],
      ["mainland", mainland],
    ] as const) {
      const asked: Asked[] = [];
      const { client, stored } = accountWith(
        answering({ [url]: { status: 200, body: answered } }, asked),
        region,
      );

      await client.setApiKey("zai-good");

      expect(asked).toEqual([
        {
          url,
          method: "POST",
          key: "Bearer zai-good",
          body: {
            model: "glm-4.7-flash",
            messages: [{ role: "user", content: "Hi" }],
            max_tokens: 1,
          },
        },
      ]);
      expect(stored()).toBe("zai-good");
    }
  });

  it("is never kept when Z.ai rejects it", async () => {
    const { client, stored } = accountWith(
      answering({
        [international]: {
          status: 401,
          body: { error: { code: "1000", message: "Authentication Failed" } },
        },
      }),
    );

    await expect(client.setApiKey("zai-wrong")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(stored()).toBeUndefined();
  });

  // Checked live 2026-10-09: the free model answered two checks in three
  // with 429, code 1305, "The service may be temporarily overloaded".
  it("is checked with one token from GLM-5.3-Flash when the free model is overloaded", async () => {
    const asked: Asked[] = [];
    const { client, stored } = accountWith(
      answeringByModel(
        {
          "glm-4.7-flash": { status: 429, body: overloaded },
          "glm-5.3-flash": { status: 200, body: answered },
        },
        asked,
      ),
    );

    await client.setApiKey("zai-good");

    expect(asked.map((each) => (each.body as { model: string }).model)).toEqual(
      ["glm-4.7-flash", "glm-5.3-flash"],
    );
    expect(asked[1]).toMatchObject({
      url: international,
      key: "Bearer zai-good",
      body: { max_tokens: 1 },
    });
    expect(stored()).toBe("zai-good");
  });

  it("is kept when Z.ai reads it but the account has no balance", async () => {
    const { client, stored } = accountWith(
      answeringByModel({
        "glm-4.7-flash": { status: 429, body: overloaded },
        "glm-5.3-flash": {
          status: 429,
          body: {
            error: {
              code: "1113",
              message:
                "Insufficient balance or no resource package. Please recharge.",
            },
          },
        },
      }),
    );

    await client.setApiKey("zai-empty");

    expect(stored()).toBe("zai-empty");
  });

  it("is kept, with a warning that it could not be checked, when Z.ai answers the check with anything else", async () => {
    const { client, stored } = accountWith(
      answering({
        [international]: {
          status: 429,
          body: {
            error: { code: "1302", message: "Rate limit reached for requests" },
          },
        },
      }),
    );

    await expect(client.setApiKey("zai-busy")).resolves.toEqual({
      status: "unverified",
      reason: expect.stringContaining("could not be checked with Z.ai"),
    });
    expect(stored()).toBe("zai-busy");
  });
});

describe("the Z.ai models offered", () => {
  it("are the shipped ones, priced on the account's platform in its currency, without asking Z.ai", async () => {
    const asked: Asked[] = [];
    const { client } = accountWith(answering({}, asked), "mainland");

    expect(await client.models()).toEqual({
      status: "ready",
      models: [
        {
          id: "glm-5.3",
          name: "GLM-5.3",
          contextWindow: 1_000_000,
          acceptsImages: false,
          reasoning: true,
          price: {
            currency: "CNY",
            input: 8,
            cacheRead: 2,
            output: 28,
            checked: "2026-10-09",
          },
        },
        {
          id: "glm-5.3-flash",
          name: "GLM-5.3-Flash",
          contextWindow: 1_000_000,
          acceptsImages: true,
          reasoning: true,
          price: {
            currency: "CNY",
            input: 0.8,
            cacheRead: 0.23,
            output: 2.8,
            checked: "2026-10-09",
          },
        },
        {
          id: "glm-5.3-flashx",
          name: "GLM-5.3-FlashX",
          contextWindow: 1_000_000,
          acceptsImages: true,
          reasoning: true,
          price: {
            currency: "CNY",
            input: 2,
            cacheRead: 0.57,
            output: 7,
            checked: "2026-10-09",
          },
        },
      ],
    });
    expect(asked).toEqual([]);
  });

  it("are priced in US dollars on the international platform", async () => {
    const { client } = accountWith(answering({}));

    const catalog = await client.models();

    expect(
      catalog.status === "ready" &&
        catalog.models.map(({ id, price }) => [
          id,
          price?.currency,
          price?.input,
          price?.cacheRead,
          price?.output,
        ]),
    ).toEqual([
      ["glm-5.3", "USD", 1.4, 0.26, 4.4],
      ["glm-5.3-flash", "USD", 0.15, 0.03, 0.5],
      ["glm-5.3-flashx", "USD", 0.37, 0.075, 1.25],
    ]);
  });
});

describe("Z.ai's settings", () => {
  it("say earlier turns go back with their reasoning, and give the model's window and the platform's host", async () => {
    const client = new ProviderModelClient(zai, {
      region: "mainland",
      model: "glm-5.3",
      apiKey: async () => "zai-test-key",
      catalogFetch: answering({}),
      modelInfo: (model) => zai.describe(model, { region: "mainland" }),
    });

    expect(await client.settings()).toMatchObject({
      model: "glm-5.3",
      contextWindow: 1_000_000,
      maximumOutputTokens: 131_072,
      acceptsImages: false,
      reasoning: {
        status: "available",
        required: true,
        defaultEffort: "max",
        efforts: ["low", "high", "max"],
      },
      reasoningSentBack: true,
      endpoint: mainland,
    });
  });
});
