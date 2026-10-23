import { describe, expect, it, vi } from "vitest";
import type {
  AppEvent,
  ModelListState,
  ProviderSettings,
  ProviderTarget,
} from "@zhiyin/contract";
import type {
  ModelClient,
  ModelListControl,
  ProviderDirectory,
} from "@zhiyin/model-client";
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
 * The least reasoning a turn may ask the chosen model for partway: none where
 * the model is known to answer without it, and otherwise its lowest effort.
 */
describe("the least reasoning a turn may ask of the model", () => {
  const optional = {
    status: "available",
    required: false,
    defaultEnabled: true,
    efforts: ["high", "low", "medium"],
  } as const;
  const least = async (stated: Partial<ProviderSettings>) =>
    (await chosenSettings(stated)).settings.forTurns().leastReasoning();

  it("is none where the model lists reasoning as optional", async () => {
    expect(await least({ reasoning: optional })).toEqual({ enabled: false });
  });

  it("is the lowest effort the model lists where it requires reasoning", async () => {
    expect(await least({ reasoning: { ...optional, required: true } })).toEqual(
      { enabled: true, effort: "low" },
    );
  });

  it("is nothing to ask where the model requires reasoning and lists no effort, or its controls are unknown", async () => {
    expect(
      await least({ reasoning: { ...optional, required: true, efforts: [] } }),
    ).toBeUndefined();
    expect(
      await least({ reasoning: { status: "unavailable", reason: "Unknown." } }),
    ).toBeUndefined();
    expect(await least({})).toBeUndefined();
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

describe("settings read while the catalogue was out of reach", () => {
  function flakyCatalogue() {
    let reachable = false;
    let reads = 0;
    const model = {
      settings: async () => {
        reads += 1;
        return reachable
          ? { ...listed("vision-model"), acceptsImages: true }
          : {
              ...listed("vision-model"),
              acceptsImages: false,
              lookupFailed: true as const,
            };
      },
    } as unknown as ModelClient;
    return {
      model,
      reach: () => {
        reachable = true;
      },
      reads: () => reads,
    };
  }

  it("are read again when they are next needed", async () => {
    const catalogue = flakyCatalogue();
    const settings = new ModelSettings(catalogue.model, () => {});
    await settings.refresh();
    expect(settings.forTurns().acceptsImages()).toBe(false);
    // Not known, rather than known not to see.
    expect(settings.seesPictures()).toBeUndefined();

    catalogue.reach();
    await settings.readIfUnknown();

    expect(settings.forTurns().acceptsImages()).toBe(true);
    expect(settings.seesPictures()).toBe(true);
    settings.stop();
  });

  it("are known to each asker once the catalogue answered, though a later read overtook theirs", async () => {
    let reads = 0;
    const model = {
      settings: async () => {
        reads += 1;
        if (reads === 1)
          return {
            ...listed("vision-model"),
            acceptsImages: false,
            lookupFailed: true as const,
          };
        // The second read answers at once, the third a little later.
        if (reads === 3) await new Promise((done) => setTimeout(done, 20));
        return { ...listed("vision-model"), acceptsImages: true };
      },
    } as unknown as ModelClient;
    const settings = new ModelSettings(model, () => {});
    await settings.refresh();

    const seen = await Promise.all([
      settings.readIfUnknown().then(() => settings.seesPictures()),
      settings.readIfUnknown().then(() => settings.seesPictures()),
    ]);

    expect(seen).toEqual([true, true]);
    settings.stop();
  });

  it("are not read again once the catalogue answered", async () => {
    const catalogue = flakyCatalogue();
    catalogue.reach();
    const settings = new ModelSettings(catalogue.model, () => {});
    await settings.refresh();

    await settings.readIfUnknown();

    expect(catalogue.reads()).toBe(1);
  });

  it("are read again by themselves, at growing intervals, until the catalogue answers", async () => {
    vi.useFakeTimers();
    try {
      const catalogue = flakyCatalogue();
      const settings = new ModelSettings(catalogue.model, () => {});
      await settings.refresh();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(catalogue.reads()).toBe(2);
      catalogue.reach();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(catalogue.reads()).toBe(3);
      expect(settings.forTurns().acceptsImages()).toBe(true);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(catalogue.reads()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("wait at most five minutes between reads while the catalogue stays out of reach", async () => {
    vi.useFakeTimers();
    try {
      const catalogue = flakyCatalogue();
      const settings = new ModelSettings(catalogue.model, () => {});
      await settings.refresh();
      // Reads after 5, 10, 20, 40, 80 and 160 seconds, then every 300.
      await vi.advanceTimersByTimeAsync(315_000);
      expect(catalogue.reads()).toBe(7);

      await vi.advanceTimersByTimeAsync(299_000);
      expect(catalogue.reads()).toBe(7);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(catalogue.reads()).toBe(8);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(catalogue.reads()).toBe(9);
      settings.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("are not read again once the app is closing", async () => {
    vi.useFakeTimers();
    try {
      const catalogue = flakyCatalogue();
      const settings = new ModelSettings(catalogue.model, () => {});
      await settings.refresh();

      settings.stop();
      await vi.advanceTimersByTimeAsync(600_000);

      expect(catalogue.reads()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("say when what the model accepts changed, so tools that depend on it are listed again", async () => {
    const catalogue = flakyCatalogue();
    let changes = 0;
    const settings = new ModelSettings(catalogue.model, () => {}, undefined, {
      modelChanged: () => {
        changes += 1;
      },
    });
    await settings.refresh();
    await settings.refresh();
    expect(changes).toBe(1);
    catalogue.reach();
    await settings.refresh();
    expect(changes).toBe(2);
    settings.stop();
  });

  it("say when another model is chosen, though it accepts the same", async () => {
    let chosen = "first-model";
    let changes = 0;
    const settings = new ModelSettings(
      {
        settings: async () => ({ ...listed(chosen), acceptsImages: true }),
      } as unknown as ModelClient,
      () => {},
      undefined,
      {
        modelChanged: () => {
          changes += 1;
        },
      },
    );
    await settings.refresh();

    chosen = "second-model";
    await settings.refresh();

    expect(changes).toBe(2);
    settings.stop();
  });
});

describe("the model list the labs answer from", () => {
  function lists(): ModelListControl {
    const listeners: (() => void)[] = [];
    let state: ModelListState = {
      source: "shipped",
      version: 1,
      published: "2026-10-22",
      updates: true,
    };
    return {
      state: () => state,
      check: async () => {
        state = { ...state, source: "downloaded", version: 2 };
        for (const listener of listeners) listener();
        return state;
      },
      setUpdates: async (enabled) => (state = { ...state, updates: enabled }),
      onChanged: (listener) => listeners.push(listener),
    };
  }

  it("reads the chosen model's settings again once a newer list comes into force", async () => {
    let window = 64_000;
    const events: AppEvent[] = [];
    const settings = new ModelSettings(
      {
        settings: async () => ({
          ...listed("lab-model"),
          contextWindow: window,
        }),
      } as unknown as ModelClient,
      (event) => events.push(event),
      undefined,
      { modelList: lists() },
    );
    await settings.refresh();
    window = 128_000;

    expect(await settings.checkModelList()).toMatchObject({
      source: "downloaded",
      version: 2,
    });
    await vi.waitFor(() =>
      expect(settings.current()?.contextWindow).toBe(128_000),
    );
    expect(events.at(-1)).toMatchObject({
      kind: "providerSettingsChanged",
      data: { contextWindow: 128_000 },
    });
    settings.stop();
  });

  it("keeps whether newer lists are read as the person sets it", async () => {
    const settings = new ModelSettings(
      { settings: async () => listed("lab-model") } as unknown as ModelClient,
      () => {},
      undefined,
      { modelList: lists() },
    );

    expect(await settings.setModelListUpdates(false)).toMatchObject({
      updates: false,
    });
    expect((await settings.modelList()).updates).toBe(false);
  });
});
