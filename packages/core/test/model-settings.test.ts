import { describe, expect, it } from "vitest";
import type {
  AppEvent,
  ProviderSettings,
  ProviderTarget,
} from "@zhiyin/contract";
import type { ModelClient, ProviderDirectory } from "@zhiyin/model-client";
import { ModelSettings } from "../src/model-settings.js";

/** Where a provider's keys and billing are, which only links need. */
const pages = {
  keys: "https://provider.example/keys",
  billing: "https://provider.example/billing",
};
const listed = (model: string, providers: string[] = []): ProviderSettings => ({
  model,
  providers,
  contextWindow: 64_000,
  maximumOutputTokens: 4_000,
  endpoint: "https://openrouter.ai/api/v1",
  credential: { status: "configured", source: "credentialStore" },
});

async function chosenSettings(stated: Partial<ProviderSettings> = {}) {
  let chosen = { ...listed("small-model"), ...stated };
  const events: AppEvent[] = [];
  const model = {
    settings: async () => chosen,
    selectModel: async (name: string, providers: readonly string[]) => {
      chosen = listed(name, [...providers]);
    },
  } as unknown as ModelClient;
  const directory: ProviderDirectory = {
    list: async () => [],
    for: (target) =>
      ({
        selectModel: async (name: string, providers: readonly string[]) => {
          chosen = {
            ...listed(name, [...providers]),
            provider: {
              id: target.provider,
              name: target.provider,
              pages,
              ...(target.region
                ? { region: { id: target.region, name: target.region } }
                : {}),
            },
          };
        },
      }) as unknown as ModelClient,
  };
  const settings = new ModelSettings(
    model,
    (event) => events.push(event),
    directory,
  );
  await settings.refresh();
  return { settings, events };
}

/**
 * A turn may turn the model's reasoning off partway only where the chosen
 * model is known to answer without it.
 */
describe("whether a turn may go on without the model's reasoning", () => {
  const optional = {
    status: "available",
    required: false,
    defaultEnabled: true,
    efforts: ["high"],
  } as const;
  const drops = async (stated: Partial<ProviderSettings>) =>
    (await chosenSettings(stated)).settings.forTurns().reasoningOptional();

  it("is yes where the model lists reasoning as optional", async () => {
    expect(await drops({ reasoning: optional })).toBe(true);
  });

  it("is no where the model requires reasoning, or its controls are unknown", async () => {
    expect(await drops({ reasoning: { ...optional, required: true } })).toBe(
      false,
    );
    expect(
      await drops({ reasoning: { status: "unavailable", reason: "Unknown." } }),
    ).toBe(false);
    expect(await drops({})).toBe(false);
  });
});

describe("the window planned with after a refusal as too long", () => {
  it("is lowered for the model and upstreams it was refused on, and says what was refused", async () => {
    const { settings, events } = await chosenSettings();

    settings.lowerWindow(6_000, 8_000);

    expect(settings.current()).toMatchObject({
      contextWindow: 6_000,
      refusedTokens: 8_000,
    });
    expect(events.at(-1)).toEqual({
      kind: "providerSettingsChanged",
      data: settings.current(),
    });
  });

  it("is never raised by a refusal that states a larger limit", async () => {
    const { settings } = await chosenSettings();

    settings.lowerWindow(6_000, 8_000);
    settings.lowerWindow(70_000, 90_000);

    expect(settings.current()?.contextWindow).toBe(6_000);
  });

  it("holds when the same choice is read again", async () => {
    const { settings } = await chosenSettings();

    settings.lowerWindow(6_000, 8_000);
    await settings.refresh();

    expect(settings.current()?.contextWindow).toBe(6_000);
  });

  it("is let go when the same model is chosen on another provider", async () => {
    const { settings } = await chosenSettings();

    settings.lowerWindow(6_000, 8_000);
    await settings.selectModel("small-model", [], {
      provider: "lab",
      region: "mainland",
    });

    expect(settings.current()?.contextWindow).toBe(64_000);
  });

  it("is let go when another model or other upstreams are chosen", async () => {
    const { settings } = await chosenSettings();

    settings.lowerWindow(6_000, 8_000);
    await settings.selectModel("small-model", ["deepinfra/fp4"]);

    expect(settings.current()?.contextWindow).toBe(64_000);
    expect(settings.current()?.refusedTokens).toBeUndefined();
  });
});

/**
 * Every provider and region the person may set up, each answering for itself:
 * a key or a model is set up for the provider it was offered to, whichever one
 * is chosen.
 */
function providersSetUp() {
  const keys = new Map<string, string>();
  let chosen: ProviderSettings = listed("vendor/chosen");
  const events: AppEvent[] = [];
  const name = (target: ProviderTarget) =>
    [target.provider, target.region].filter(Boolean).join(":");
  const target = (at: ProviderTarget) =>
    ({
      settings: async () => ({
        ...chosen,
        credential: keys.has(name(at))
          ? { status: "configured", source: "credentialStore" }
          : { status: "missing", source: "none" },
      }),
      setApiKey: async (apiKey: string) => {
        if (apiKey === "refused") throw new Error("The lab rejected the key.");
        keys.set(name(at), apiKey);
        return apiKey === "unchecked"
          ? { status: "unverified", reason: "The lab could not be reached." }
          : { status: "accepted" };
      },
      clearApiKey: async () => void keys.delete(name(at)),
      models: async () => ({
        status: "unavailable",
        reason: `Models of ${name(at)}`,
      }),
      selectModel: async (model: string, upstreams: readonly string[]) => {
        chosen = {
          ...listed(model, [...upstreams]),
          provider: { id: at.provider, name: at.provider, pages },
        };
      },
    }) as unknown as ModelClient;
  const model = target({ provider: "openrouter" });
  const directory: ProviderDirectory = {
    list: async () => [
      {
        id: "openrouter",
        name: "OpenRouter",
        accounts: [
          { credential: { status: "missing", source: "none" }, pages },
        ],
      },
    ],
    for: target,
  };
  const settings = new ModelSettings(
    model,
    (event) => events.push(event),
    directory,
  );
  return { settings, events, keys };
}

describe("setting up a provider other than the chosen one", () => {
  const mainland = { provider: "lab", region: "mainland" };

  it("keeps a key for that provider and region alone", async () => {
    const { settings, keys } = providersSetUp();

    const outcome = await settings.saveApiKey("lab-key", mainland);

    expect(outcome).toEqual({ status: "accepted" });
    expect(Object.fromEntries(keys)).toEqual({ "lab:mainland": "lab-key" });
  });

  it("reports a refusal from the provider the key was offered to", async () => {
    const { settings, keys } = providersSetUp();

    const outcome = await settings.saveApiKey("refused", mainland);

    expect(outcome).toEqual({
      status: "refused",
      reason: "The lab rejected the key.",
    });
    expect(keys.size).toBe(0);
  });

  it("reports a refused key as refused when an earlier key is still kept", async () => {
    const { settings, keys } = providersSetUp();
    await settings.saveApiKey("lab-key", mainland);

    const outcome = await settings.saveApiKey("refused", mainland);

    expect(outcome).toEqual({
      status: "refused",
      reason: "The lab rejected the key.",
    });
    expect(keys.get("lab:mainland")).toBe("lab-key");
  });

  it("reports a key kept without a check as unverified, not refused", async () => {
    const { settings, keys } = providersSetUp();

    const outcome = await settings.saveApiKey("unchecked", mainland);

    expect(outcome).toEqual({
      status: "unverified",
      reason: "The lab could not be reached.",
    });
    expect(keys.get("lab:mainland")).toBe("unchecked");
  });

  it("removes a key from that provider and region alone", async () => {
    const { settings, keys } = providersSetUp();
    await settings.saveApiKey("openrouter-key");
    await settings.saveApiKey("lab-key", mainland);

    await settings.clearApiKey(mainland);

    expect(Object.fromEntries(keys)).toEqual({ openrouter: "openrouter-key" });
  });

  it("lists that provider's models", async () => {
    const { settings } = providersSetUp();

    expect(await settings.models(mainland)).toEqual({
      status: "unavailable",
      reason: "Models of lab:mainland",
    });
  });

  it("chooses a model there and tells the window the choice moved", async () => {
    const { settings, events } = providersSetUp();

    await settings.selectModel("lab-model", [], mainland);

    expect(events.at(-1)).toEqual({
      kind: "providerSettingsChanged",
      data: expect.objectContaining({
        model: "lab-model",
        provider: { id: "lab", name: "lab", pages },
      }),
    });
  });

  it("lists every provider with its regions and keys", async () => {
    const { settings } = providersSetUp();

    expect(await settings.providers()).toEqual([
      {
        id: "openrouter",
        name: "OpenRouter",
        accounts: [
          { credential: { status: "missing", source: "none" }, pages },
        ],
      },
    ]);
  });
});
