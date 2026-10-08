import { describe, expect, it } from "vitest";
import type { AppEvent, ProviderSettings } from "@zhiyin/contract";
import type { ModelClient } from "@zhiyin/model-client";
import { ModelSettings } from "../src/model-settings.js";

const listed = (model: string, providers: string[] = []): ProviderSettings => ({
  model,
  providers,
  contextWindow: 64_000,
  maximumOutputTokens: 4_000,
  endpoint: "https://openrouter.ai/api/v1",
  credential: { status: "configured", source: "credentialStore" },
});

async function chosenSettings() {
  let chosen = listed("small-model");
  const events: AppEvent[] = [];
  const model = {
    settings: async () => chosen,
    selectModel: async (name: string, providers: readonly string[]) => {
      chosen = listed(name, [...providers]);
    },
  } as unknown as ModelClient;
  const settings = new ModelSettings(model, (event) => events.push(event));
  await settings.refresh();
  return { settings, events };
}

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

  it("is let go when another model or other upstreams are chosen", async () => {
    const { settings } = await chosenSettings();

    settings.lowerWindow(6_000, 8_000);
    await settings.selectModel("small-model", ["deepinfra/fp4"]);

    expect(settings.current()?.contextWindow).toBe(64_000);
    expect(settings.current()?.refusedTokens).toBeUndefined();
  });
});
