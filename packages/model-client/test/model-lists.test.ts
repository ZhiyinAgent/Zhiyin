/**
 * A lab's models come from a list shipped with the app (ADR 0015): what each
 * model can do, and its prices on each of the lab's platforms, with the day
 * the list was checked. A model not on the list is not offered, and what the
 * list does not state is unknown rather than assumed.
 */

import { describe, expect, it } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import { fromModelList, type ModelList } from "../src/model-list.js";
import type { CatalogOptions } from "../src/provider.js";
import { twoRegionProvider } from "./test-provider.js";

const list: ModelList = {
  checked: "2026-10-09",
  models: [
    {
      id: "lab-large",
      name: "Lab Large",
      contextWindow: 1_000_000,
      maximumOutputTokens: 384_000,
      acceptsImages: false,
      reasoning: {
        status: "available",
        required: true,
        defaultEnabled: true,
        defaultEffort: "high",
        efforts: ["high", "max"],
      },
      offered: {
        international: { currency: "USD", input: 0.66, output: 1.98 },
        mainland: { currency: "CNY", input: 4, output: 12 },
      },
    },
    {
      id: "lab-vision",
      name: "Lab Vision",
      contextWindow: 256_000,
      acceptsImages: true,
      reasoning: {
        status: "unavailable",
        reason: "The lab does not say how its reasoning is set.",
      },
      offered: {
        international: { currency: "USD", input: 0.15, output: 0.6 },
      },
    },
  ],
};

function labClient(
  region: string,
  model: string,
  listedByApi?: (options: CatalogOptions) => Promise<ReadonlySet<string>>,
) {
  const provider = twoRegionProvider([], fromModelList(list, listedByApi));
  return new ProviderModelClient(provider, {
    apiKey: async () => "key",
    model,
    region,
    modelInfo: (id) => provider.describe(id, { region }),
  });
}

describe("a lab's shipped model list", () => {
  it("offers the models of the account's platform, priced in its currency, with the day the list was checked", async () => {
    expect(await labClient("mainland", "lab-large").models()).toEqual({
      status: "ready",
      models: [
        {
          id: "lab-large",
          name: "Lab Large",
          contextWindow: 1_000_000,
          acceptsImages: false,
          reasoning: true,
          price: {
            currency: "CNY",
            input: 4,
            output: 12,
            checked: "2026-10-09",
          },
        },
      ],
    });
  });

  it("does not offer a shipped model the lab no longer lists", async () => {
    const client = labClient(
      "international",
      "lab-large",
      async () => new Set(["lab-vision", "lab-newer"]),
    );

    const catalog = await client.models();

    expect(
      catalog.status === "ready" && catalog.models.map((model) => model.id),
    ).toEqual(["lab-vision"]);
  });

  it("keeps the shipped list when the lab's own listing cannot be read", async () => {
    const client = labClient("international", "lab-large", async () => {
      throw new Error("offline");
    });

    const catalog = await client.models();

    expect(
      catalog.status === "ready" && catalog.models.map((model) => model.id),
    ).toEqual(["lab-large", "lab-vision"]);
  });

  it("gives the chosen model's window, reasoning and pictures from its entry", async () => {
    const settings = await labClient("international", "lab-vision").settings();

    expect(settings).toMatchObject({
      contextWindow: 256_000,
      acceptsImages: true,
      reasoning: {
        status: "unavailable",
        reason: "The lab does not say how its reasoning is set.",
      },
    });
    expect(settings.maximumOutputTokens).toBeUndefined();
    expect(
      (await labClient("international", "lab-large").settings()).reasoning,
    ).toEqual(list.models[0]?.reasoning);
  });

  it("knows nothing of a model that is not on the list", async () => {
    const settings = await labClient(
      "international",
      "lab-unlisted",
    ).settings();

    expect(settings.contextWindow).toBeUndefined();
    expect(settings.acceptsImages).toBe(false);
    expect(settings.reasoning?.status).toBe("unavailable");
  });

  it("lists no upstreams: only OpenRouter routes between them", async () => {
    expect(
      await labClient("international", "lab-large").modelProviders("lab-large"),
    ).toEqual({ status: "ready", model: "lab-large", providers: [] });
  });
});
