import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ModelCatalog,
  ModelProviderList,
  ProviderSettings,
  ProviderSummary,
} from "@zhiyin/contract";
import { ModelSettings } from "./ModelSettings.js";

const openRouterPages = {
  keys: "https://openrouter.ai/settings/keys",
  billing: "https://openrouter.ai/settings/credits",
};

const connected: ProviderSettings = {
  provider: {
    id: "openrouter",
    name: "OpenRouter",
    upstreams: true,
    pages: openRouterPages,
  },
  model: "z-ai/glm-5.3-flash",
  providers: [],
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  credential: { status: "configured", source: "credentialStore" },
};

const catalog: ModelCatalog = {
  status: "ready",
  models: [
    {
      id: "z-ai/glm-5.3-flash",
      name: "Z.ai: GLM 5.3 Flash",
      contextWindow: 1_310_720,
      inputUsdPerMillion: 0.075,
      outputUsdPerMillion: 0.25,
      acceptsImages: true,
      reasoning: true,
    },
    {
      id: "anthropic/claude-sonnet-5",
      name: "Anthropic: Claude Sonnet 5",
      contextWindow: 1_000_000,
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 10,
      acceptsImages: true,
      reasoning: true,
    },
  ],
};

const providers: ModelProviderList = {
  status: "ready",
  model: "z-ai/glm-5.3-flash",
  providers: [
    {
      slug: "crusoe/fp4",
      name: "Crusoe",
      quantization: "fp4",
      tier: null,
      region: null,
      contextWindow: 1_048_576,
      maximumOutputTokens: 131_072,
      inputUsdPerMillion: 0.15,
      outputUsdPerMillion: 0.5,
      acceptsTools: true,
      responseMs: 780,
      tokensPerSecond: 132,
      uptimePercent: 100,
    },
    {
      slug: "relace/fp4",
      name: "Relace",
      quantization: "fp4",
      tier: null,
      region: null,
      contextWindow: 1_048_576,
      maximumOutputTokens: 131_072,
      inputUsdPerMillion: 0.09,
      outputUsdPerMillion: 0.3,
      acceptsTools: true,
      responseMs: null,
      tokensPerSecond: null,
      uptimePercent: null,
    },
    {
      slug: "z-ai/fp8",
      name: "Z.AI",
      quantization: "fp8",
      tier: null,
      region: null,
      contextWindow: 1_048_576,
      maximumOutputTokens: 131_072,
      inputUsdPerMillion: 0.075,
      outputUsdPerMillion: 0.25,
      acceptsTools: false,
      responseMs: 3726,
      tokensPerSecond: 38,
      uptimePercent: 86.1,
    },
  ],
};

/** One model reached through a provider's tiers and regions. */
const tiered: ModelProviderList = {
  status: "ready",
  model: "openai/gpt-6-luna",
  providers: [
    ["openai/flex", "OpenAI", "flex", null, 0.05],
    ["openai", "OpenAI", null, null, 0.1],
    ["openai/fast", "OpenAI", "priority", null, 0.2],
    ["azure/eu", "Azure", null, "eu", 0.11],
  ].map(([slug, name, tier, region, input]) => ({
    slug: slug as string,
    name: name as string,
    quantization: null,
    tier: tier as "flex" | "priority" | null,
    region: region as string | null,
    contextWindow: 1_050_000,
    maximumOutputTokens: 128_000,
    inputUsdPerMillion: input as number,
    outputUsdPerMillion: (input as number) * 5,
    acceptsTools: true,
    responseMs: 1_900,
    tokensPerSecond: 50,
    uptimePercent: 100,
  })),
};

/** OpenRouter, with its key stored, and two labs not yet usable or usable. */
const shipped: readonly ProviderSummary[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    upstreams: true,
    accounts: [
      {
        credential: { status: "configured", source: "credentialStore" },
        pages: openRouterPages,
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    accounts: [
      {
        region: { id: "international", name: "International" },
        credential: { status: "missing", source: "none" },
        pages: {
          keys: "https://platform.deepseek.com/api_keys",
          billing: "https://platform.deepseek.com/",
        },
      },
      {
        region: { id: "mainland", name: "Mainland China" },
        credential: { status: "configured", source: "credentialStore" },
        pages: {
          keys: "https://platform.deepseek.com/api_keys",
          billing: "https://platform.deepseek.com/",
        },
      },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    unavailable:
      "Zhiyin has not yet been checked against this lab's live service.",
    accounts: [
      {
        credential: { status: "missing", source: "none" },
        pages: {
          keys: "https://console.mistral.ai/api-keys",
          billing: "https://admin.mistral.ai/organization/billing",
        },
      },
    ],
  },
];

function renderPanel(
  overrides: Partial<Parameters<typeof ModelSettings>[0]> = {},
) {
  const onSelectModel = vi.fn(async () => {});
  const props = {
    settings: connected,
    onClose: () => undefined,
    onListProviders: async () => shipped,
    onListModels: async () => catalog,
    onListModelProviders: async () => providers,
    onSelectModel,
    onSaveApiKey: async () => ({ status: "accepted" as const }),
    onClearApiKey: async () => {},
    ...overrides,
  };
  render(<ModelSettings {...props} />);
  return { onSelectModel };
}

describe("ModelSettings", () => {
  it("leaves the budget to the context ring: there is no budget here", () => {
    renderPanel({ settings: { ...connected, contextWindow: 1_000_000 } });

    expect(
      screen.queryByRole("radiogroup", {
        name: "Budget for new conversations",
      }),
    ).toBeNull();
  });

  it("finds a model from an inexact query", async () => {
    renderPanel();
    await screen.findByRole("radio", { name: /Claude Sonnet 5/ });

    fireEvent.change(screen.getByLabelText("Search models"), {
      target: { value: "son5" },
    });

    expect(
      screen.getByRole("radio", { name: /Claude Sonnet 5/ }),
    ).toBeVisible();
    expect(screen.queryByRole("radio", { name: /GLM 5.3 Flash/ })).toBeNull();
  });

  it("shows a lab's own price in its own currency, and says when none is listed", async () => {
    renderPanel({
      onListModels: async () => ({
        status: "ready",
        models: [
          {
            id: "deepseek-v4-pro",
            name: "DeepSeek V4 Pro",
            contextWindow: 1_000_000,
            acceptsImages: false,
            reasoning: true,
            price: {
              currency: "CNY",
              input: 4,
              output: 16,
              checked: "2026-10-09",
            },
          },
          {
            id: "lab-unpriced",
            name: "Lab Unpriced",
            contextWindow: 128_000,
            acceptsImages: false,
            reasoning: false,
          },
        ],
      }),
    });

    expect(
      await screen.findByRole("radio", { name: /DeepSeek V4 Pro/ }),
    ).toHaveTextContent("¥4.00 in / ¥16.00 out");
    expect(
      screen.getByRole("radio", { name: /Lab Unpriced/ }),
    ).toHaveTextContent("Price not listed");
  });

  it("finds the lower-cost models of a lab priced in yuan, and gives no advice about slashes its ids do not have", async () => {
    renderPanel({
      onListModels: async () => ({
        status: "ready",
        models: [
          {
            id: "deepseek-v4-flash",
            name: "DeepSeek V4 Flash",
            contextWindow: 1_000_000,
            acceptsImages: false,
            reasoning: true,
            price: {
              currency: "CNY",
              input: 1,
              output: 2,
              checked: "2026-10-09",
            },
          },
          {
            id: "deepseek-v4-pro",
            name: "DeepSeek V4 Pro",
            contextWindow: 1_000_000,
            acceptsImages: false,
            reasoning: true,
            price: {
              currency: "CNY",
              input: 12,
              output: 24,
              checked: "2026-10-09",
            },
          },
        ],
      }),
    });
    await screen.findByRole("radio", { name: /DeepSeek V4 Pro/ });

    fireEvent.click(screen.getByRole("checkbox", { name: "Lower cost" }));

    expect(
      screen.getByRole("radio", { name: /DeepSeek V4 Flash/ }),
    ).toBeVisible();
    expect(screen.queryByRole("radio", { name: /DeepSeek V4 Pro/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search models"), {
      target: { value: "nothing like it" },
    });
    expect(screen.getByText("Nothing matches")).toBeVisible();
    expect(screen.queryByText(/slash/)).toBeNull();
  });

  it("suggests searching after the slash where the models' ids have one", async () => {
    renderPanel();
    await screen.findByRole("radio", { name: /Claude Sonnet 5/ });

    fireEvent.change(screen.getByLabelText("Search models"), {
      target: { value: "nothing like it" },
    });

    expect(screen.getByText(/after the slash/)).toBeVisible();
  });

  it("keeps a model readable by name while its matched characters are emphasised", async () => {
    renderPanel();
    await screen.findByRole("radio", { name: /Claude Sonnet 5/ });

    fireEvent.change(screen.getByLabelText("Search models"), {
      target: { value: "son5" },
    });

    // Emphasis splits the name across elements; the row must still be named
    // "Anthropic: Claude Sonnet 5", not "Anthropic: ClaudeSonnet5".
    expect(
      screen.getByRole("radio", {
        name: "Anthropic: Claude Sonnet 5 anthropic/claude-sonnet-5",
      }),
    ).toBeVisible();
  });

  it("saves the model and the chosen upstreams as one change", async () => {
    const { onSelectModel } = renderPanel();
    const crusoe = await screen.findByRole("checkbox", { name: "Crusoe" });

    fireEvent.click(crusoe);
    fireEvent.click(screen.getByRole("checkbox", { name: "Relace" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSelectModel).toHaveBeenCalledWith(
        "z-ai/glm-5.3-flash",
        ["crusoe/fp4", "relace/fp4"],
        { provider: "openrouter" },
      ),
    );
  });

  it("can select more than one upstream, so a busy one is not the end of it", async () => {
    renderPanel();
    const crusoe = await screen.findByRole("checkbox", { name: "Crusoe" });

    fireEvent.click(crusoe);
    fireEvent.click(screen.getByRole("checkbox", { name: "Relace" }));

    expect(crusoe).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Relace" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByRole("checkbox", { name: /Any provider/ }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("names each upstream by its provider and variant, and says what a tier trades", async () => {
    renderPanel({ onListModelProviders: async () => tiered });

    expect(
      await screen.findByRole("checkbox", { name: "OpenAI, flex tier" }),
    ).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "OpenAI" })).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "OpenAI, priority tier" }),
    ).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Azure, EU" })).toBeVisible();
    expect(
      screen.getByText("Flex tier: cheaper, slower, may refuse when busy"),
    ).toBeVisible();
    expect(screen.getByText("Priority tier: faster, costs more")).toBeVisible();
    expect(screen.getByText("Region: EU")).toBeVisible();
    expect(screen.queryByText(/Precision not stated/)).toBeNull();
  });

  it("warns that flex alone fails when busy, until a standard upstream is chosen too", async () => {
    renderPanel({ onListModelProviders: async () => tiered });

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "OpenAI, flex tier" }),
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "Only flex is chosen: when it is busy, requests fail instead of moving on. Choose a standard provider too.",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "OpenAI" }));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("refuses an upstream that cannot run tools", async () => {
    renderPanel();

    expect(
      await screen.findByRole("checkbox", { name: "Z.AI" }),
    ).toBeDisabled();
    expect(screen.getByText("Can't use tools")).toBeVisible();
  });

  it("names the model in use once, keeping its id on hover", async () => {
    renderPanel();

    const current = screen.getByText("Now using").parentElement!;
    const name = await within(current).findByText("Z.ai: GLM 5.3 Flash");
    expect(name).toHaveAttribute("data-tip", "z-ai/glm-5.3-flash");
    expect(within(current).queryByText("z-ai/glm-5.3-flash")).toBeNull();
    // And where its requests go.
    expect(
      within(current).getByText("Requests go to openrouter.ai"),
    ).toBeVisible();
    // The providers are headed by the same name.
    expect(
      within(screen.getByRole("region", { name: "Providers" })).getByRole(
        "heading",
        { name: "Z.ai: GLM 5.3 Flash" },
      ),
    ).toBeVisible();
  });

  /** Not a choice: a model that cannot call tools cannot run Zhiyin at all. */
  it("says that only models that can use tools are listed, rather than offering it as a filter", () => {
    renderPanel();

    expect(
      screen.getByText(
        "Showing only models that can use tools, which Zhiyin needs.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Tool use" })).toBeNull();
  });

  it("shows an absent measurement as absent rather than as zero", async () => {
    renderPanel();
    const relace = await screen.findByRole("checkbox", { name: "Relace" });

    expect(relace.textContent).toContain("—");
    expect(relace.textContent).not.toContain("0 ms");
  });

  it("forgets the chosen upstreams when the model changes", async () => {
    const { onSelectModel } = renderPanel();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Crusoe" }));
    fireEvent.click(screen.getByRole("radio", { name: /Claude Sonnet 5/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSelectModel).toHaveBeenCalledWith(
        "anthropic/claude-sonnet-5",
        [],
        { provider: "openrouter" },
      ),
    );
  });

  it("keeps a draft out of effect until it is saved", async () => {
    const { onSelectModel } = renderPanel();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Crusoe" }));

    expect(screen.getByText("Not saved yet")).toBeVisible();
    expect(onSelectModel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByText("Not saved yet")).toBeNull();
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it("reports a failed save instead of appearing to have worked", async () => {
    renderPanel({
      onSelectModel: async () => {
        throw new Error("refused");
      },
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Crusoe" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The choice could not be saved.",
    );
  });

  it("offers one way to add a key, and lists nothing, when no key is stored", async () => {
    renderPanel({
      settings: {
        ...connected,
        credential: { status: "missing", source: "none" },
      },
    });

    expect(screen.getAllByRole("button", { name: "Add a key" })).toHaveLength(
      1,
    );
    expect(screen.queryByRole("radiogroup", { name: "Models" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText("Search models")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add a key" }));

    expect(
      await screen.findByRole("dialog", { name: "OpenRouter API key" }),
    ).toBeVisible();
  });

  it("asks for the model lists once, however often the window draws it again with new callbacks", async () => {
    let listed = 0;
    let upstreams = 0;
    // Each call hands in new functions, as the shell does on every event.
    const props = () => ({
      settings: connected,
      onClose: () => undefined,
      onListProviders: async () => shipped,
      onListModels: async () => {
        listed += 1;
        return catalog;
      },
      onListModelProviders: async () => {
        upstreams += 1;
        return providers;
      },
      onSelectModel: async () => {},
      onSaveApiKey: async () => ({ status: "accepted" as const }),
      onClearApiKey: async () => {},
    });
    const { rerender } = render(<ModelSettings {...props()} />);
    for (let round = 1; round <= 10; round++)
      rerender(<ModelSettings {...props()} />);

    expect(await screen.findByText("Anthropic: Claude Sonnet 5")).toBeVisible();
    expect(listed).toBe(1);
    expect(upstreams).toBe(1);
  });

  it("shows the model list when its answer arrives after the window has drawn it again", async () => {
    const answers: ((value: ModelCatalog) => void)[] = [];
    const props = () => ({
      settings: connected,
      onClose: () => undefined,
      onListProviders: async () => shipped,
      onListModels: () =>
        new Promise<ModelCatalog>((resolve) => answers.push(resolve)),
      onListModelProviders: async () => providers,
      onSelectModel: async () => {},
      onSaveApiKey: async () => ({ status: "accepted" as const }),
      onClearApiKey: async () => {},
    });
    const { rerender } = render(<ModelSettings {...props()} />);
    rerender(<ModelSettings {...props()} />);
    // The answer to what was asked first, arriving after the window drew again.
    answers[0]!(catalog);

    expect(await screen.findByText("Anthropic: Claude Sonnet 5")).toBeVisible();
  });

  it("keeps the catalogue's failure visible instead of showing an empty list", async () => {
    renderPanel({
      onListModels: async () => ({
        status: "unavailable",
        reason: "The model list could not be reached.",
      }),
    });

    expect(
      await screen.findByText("The model list could not be reached."),
    ).toBeVisible();
  });

  it("saves a key without rendering it back", async () => {
    const onSaveApiKey = vi.fn(async () => ({ status: "accepted" as const }));
    renderPanel({
      settings: {
        ...connected,
        credential: { status: "missing", source: "none" },
      },
      onSaveApiKey,
    });

    fireEvent.click(screen.getByRole("button", { name: "Add a key" }));
    fireEvent.change(await screen.findByLabelText("Paste your key"), {
      target: { value: "sk-or-v1-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() =>
      expect(onSaveApiKey).toHaveBeenCalledWith("sk-or-v1-secret", {
        provider: "openrouter",
      }),
    );
    expect(screen.queryByDisplayValue("sk-or-v1-secret")).toBeNull();
  });

  /**
   * A model the provider has stopped offering is still the stored choice, and
   * the page is where that is discovered. Saying nothing leaves a person
   * looking at a working-looking settings page and an app that fails on every
   * turn, with nothing connecting the two.
   */
  it("says no model is chosen until the person chooses one, then saves it", async () => {
    const { onSelectModel } = renderPanel({
      settings: {
        providers: [],
        endpoint: connected.endpoint,
        credential: connected.credential,
      },
    });

    const current = screen.getByText("Now using").parentElement!;
    expect(current).toHaveTextContent("No model chosen");
    fireEvent.click(
      await screen.findByRole("radio", { name: /Claude Sonnet 5/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSelectModel).toHaveBeenCalledWith(
        "anthropic/claude-sonnet-5",
        [],
      ),
    );
    expect(screen.queryByText(/no longer offered/i)).toBeNull();
  });

  it("says so when the stored model is no longer in the catalogue", async () => {
    renderPanel({
      settings: { ...connected, model: "z-ai/glm-4.9-retired" },
    });

    expect(await screen.findByText(/no longer offered/i)).toBeVisible();
  });

  it("keeps a withdrawn model as the stored choice rather than replacing it", async () => {
    const { onSelectModel } = renderPanel({
      settings: { ...connected, model: "z-ai/glm-4.9-retired" },
    });
    await screen.findByText(/no longer offered/i);

    // Still the choice on record - named as the model in use, not quietly
    // swapped for one that happens to still exist - and nothing was saved over
    // it on the way in.
    expect(screen.getAllByText("z-ai/glm-4.9-retired").length).toBeGreaterThan(
      0,
    );
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it("says nothing about withdrawal while the catalogue is still unknown", async () => {
    renderPanel({
      settings: { ...connected, model: "z-ai/glm-4.9-retired" },
      onListModels: async () => ({
        status: "unavailable",
        reason: "The model list could not be reached.",
      }),
    });
    await screen.findByText("The model list could not be reached.");

    // A catalogue that did not load is not evidence that a model is gone.
    expect(screen.queryByText(/no longer offered/i)).toBeNull();
  });

  it("says an environment key cannot be changed here", async () => {
    renderPanel({
      settings: {
        ...connected,
        credential: { status: "configured", source: "environment" },
      },
    });

    expect(await screen.findByText("Key from the environment")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Change key" }));

    expect(
      await screen.findByText(
        "This key was set for an automated run, by a variable whose name starts with ZHIYIN_. Remove the variable and restart Zhiyin to save a key here.",
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText("Paste your key")).toBeNull();
  });
});

/** DeepSeek's own list, as its provider ships it. */
const deepSeekCatalog: ModelCatalog = {
  status: "ready",
  models: [
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      contextWindow: 1_048_576,
      acceptsImages: false,
      reasoning: true,
      price: {
        currency: "CNY",
        input: 4.5,
        cacheRead: 0.15,
        output: 13.5,
        peak: {
          weekdaysUtc: [1, 2, 3, 4, 5],
          hoursUtc: [
            [1, 4],
            [6, 10],
          ],
          input: 9,
          cacheRead: 0.3,
          output: 27,
        },
        checked: "2026-10-09",
      },
    },
  ],
};

describe("choosing the provider", () => {
  it("lists every provider by name, and one that cannot be used yet unchosen, with why", async () => {
    renderPanel();

    const providers = await screen.findByRole("radiogroup", {
      name: "Provider",
    });
    expect(
      within(providers)
        .getAllByRole("radio")
        .map((option) => option.textContent),
    ).toEqual(["OpenRouter", "DeepSeek", "MistralNot available yet"]);
    expect(
      within(providers).getByRole("radio", { name: "OpenRouter" }),
    ).toBeChecked();

    const mistral = within(providers).getByRole("radio", { name: /Mistral/ });
    expect(mistral).toHaveAttribute("aria-disabled", "true");
    expect(mistral).toHaveAttribute(
      "data-tip",
      "Zhiyin has not yet been checked against this lab's live service.",
    );
    fireEvent.click(mistral);
    expect(mistral).not.toBeChecked();
  });

  it("says when the providers could not be listed, and keeps the stored one's models", async () => {
    renderPanel({
      onListProviders: async () => {
        throw new Error("The core did not answer.");
      },
    });

    expect(
      await screen.findByText("The providers could not be listed."),
    ).toBeVisible();
    expect(
      await screen.findByRole("radio", { name: /Anthropic: Claude Sonnet 5/ }),
    ).toBeVisible();
  });

  it("shows a lab's models on the platform chosen, without upstreams, and saves the lab with its platform", async () => {
    const onListModels = vi.fn(async (target?: { provider: string }) =>
      target?.provider === "deepseek" ? deepSeekCatalog : catalog,
    );
    const { onSelectModel } = renderPanel({ onListModels });

    fireEvent.click(await screen.findByRole("radio", { name: "DeepSeek" }));

    // The first platform has no key yet: its models wait for one.
    expect(screen.getByText("Add a DeepSeek key")).toBeVisible();
    const platforms = screen.getByRole("radiogroup", {
      name: "DeepSeek platform",
    });
    fireEvent.click(
      within(platforms).getByRole("radio", { name: "Mainland China" }),
    );

    fireEvent.click(
      await screen.findByRole("radio", { name: /DeepSeek V4 Pro/ }),
    );
    expect(onListModels).toHaveBeenLastCalledWith({
      provider: "deepseek",
      region: "mainland",
    });
    // Upstreams are OpenRouter's alone.
    expect(screen.queryByText(/^Providers for/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSelectModel).toHaveBeenCalledWith("deepseek-v4-pro", [], {
        provider: "deepseek",
        region: "mainland",
      }),
    );
  });

  it("details the lab model chosen: its prices on that platform, in their currency, busy hours included, and its window", async () => {
    renderPanel({
      onListModels: async (target) =>
        target?.provider === "deepseek" ? deepSeekCatalog : catalog,
    });

    fireEvent.click(await screen.findByRole("radio", { name: "DeepSeek" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mainland China" }));
    const details = await screen.findByRole("region", {
      name: "Model details",
    });
    expect(within(details).getByText("No model selected")).toBeVisible();

    fireEvent.click(
      await screen.findByRole("radio", { name: /DeepSeek V4 Pro/ }),
    );

    expect(
      within(details).getByRole("heading", { name: "DeepSeek V4 Pro" }),
    ).toBeVisible();
    expect(
      within(details).getByText("Price per million tokens, CNY"),
    ).toBeVisible();
    const row = (label: string) =>
      within(details).getByRole("row", { name: new RegExp(`^${label}`) });
    // Off-peak first, then the busy-hour price beside it.
    expect(row("Input")).toHaveTextContent("¥4.50¥9.00");
    expect(row("Cached input")).toHaveTextContent("¥0.15¥0.30");
    expect(row("Output")).toHaveTextContent("¥13.50¥27.00");
    // In the person's own time zone, whichever the test runs in.
    expect(
      within(details).getByText(/^Busy hours, your time \(.+\): \w+day/),
    ).toBeVisible();
    expect(within(details).getByText(/checked October 9, 2026/)).toBeVisible();
    expect(within(details).getByText("1M tokens")).toBeVisible();
  });

  it("details a lab model's higher tier past an input size beside its first", async () => {
    const tiered: ModelCatalog = {
      status: "ready",
      models: [
        {
          id: "deepseek-v4-long",
          name: "DeepSeek V4 Long",
          contextWindow: 1_048_576,
          acceptsImages: false,
          reasoning: true,
          price: {
            currency: "CNY",
            input: 4,
            output: 12,
            tiers: [{ aboveInputTokens: 200_000, input: 8, output: 24 }],
            checked: "2026-10-09",
          },
        },
      ],
    };
    renderPanel({
      onListModels: async (target) =>
        target?.provider === "deepseek" ? tiered : catalog,
    });

    fireEvent.click(await screen.findByRole("radio", { name: "DeepSeek" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mainland China" }));
    fireEvent.click(
      await screen.findByRole("radio", { name: /DeepSeek V4 Long/ }),
    );

    const details = screen.getByRole("region", { name: "Model details" });
    expect(
      within(details)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Up to 200K input", "Past 200K input"]);
    const row = (label: string) =>
      within(details).getByRole("row", { name: new RegExp(`^${label}`) });
    expect(row("Input")).toHaveTextContent("¥4.00¥8.00");
    expect(row("Output")).toHaveTextContent("¥12.00¥24.00");
  });

  it("saves nothing for another provider until a model is chosen on it", async () => {
    renderPanel({
      onListModels: async (target) =>
        target?.provider === "deepseek" ? deepSeekCatalog : catalog,
    });

    fireEvent.click(await screen.findByRole("radio", { name: "DeepSeek" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mainland China" }));
    await screen.findByRole("radio", { name: /DeepSeek V4 Pro/ });

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("data-tip", "Choose a model first");
  });

  it("keeps a key for the lab's platform shown, and reads the list of keys again", async () => {
    const onSaveApiKey = vi.fn(async () => ({ status: "accepted" as const }));
    const onListProviders = vi.fn(async () => shipped);
    renderPanel({ onSaveApiKey, onListProviders });

    fireEvent.click(await screen.findByRole("radio", { name: "DeepSeek" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a key" }));
    expect(
      await screen.findByRole("dialog", {
        name: "DeepSeek API key · International",
      }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Paste your key"), {
      target: { value: "sk-deepseek" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() =>
      expect(onSaveApiKey).toHaveBeenCalledWith("sk-deepseek", {
        provider: "deepseek",
        region: "international",
      }),
    );
    await waitFor(() => expect(onListProviders).toHaveBeenCalledTimes(2));
  });

  it("opens the billing page of the platform a key belongs to, alike for every provider and without reading a balance", async () => {
    const onOpenExternalUrl = vi.fn(async () => {});
    renderPanel({ onOpenExternalUrl });

    fireEvent.click(await screen.findByRole("button", { name: "Billing" }));
    expect(onOpenExternalUrl).toHaveBeenLastCalledWith(
      "https://openrouter.ai/settings/credits",
    );

    fireEvent.click(screen.getByRole("radio", { name: "DeepSeek" }));
    // No key on this platform yet, so no account to see the balance of.
    expect(screen.queryByRole("button", { name: "Billing" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Mainland China" }));
    fireEvent.click(await screen.findByRole("button", { name: "Billing" }));
    expect(onOpenExternalUrl).toHaveBeenLastCalledWith(
      "https://platform.deepseek.com/",
    );
    expect(screen.queryByText(/balance/i)).toBeNull();
  });

  it("returns to the stored provider and its choice on Discard", async () => {
    const onListModels = vi.fn(async (target?: { provider: string }) =>
      target?.provider === "deepseek" ? deepSeekCatalog : catalog,
    );
    renderPanel({ onListModels });

    fireEvent.click(await screen.findByRole("radio", { name: "DeepSeek" }));
    expect(screen.getByText("Not saved yet")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByRole("radio", { name: "OpenRouter" })).toBeChecked();
    expect(
      await screen.findByRole("radio", { name: /GLM 5.3 Flash/ }),
    ).toBeChecked();
    expect(screen.queryByText("Not saved yet")).toBeNull();
  });
});
