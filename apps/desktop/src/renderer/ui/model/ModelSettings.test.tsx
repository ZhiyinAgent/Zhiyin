import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ModelCatalog,
  ModelProviderList,
  ProviderSettings,
} from "@zhiyin/contract";
import { ModelSettings } from "./ModelSettings.js";

const connected: ProviderSettings = {
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
      contextWindow: 1_048_576,
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
      contextWindow: 1_048_576,
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
      contextWindow: 1_048_576,
      inputUsdPerMillion: 0.075,
      outputUsdPerMillion: 0.25,
      acceptsTools: false,
      responseMs: 3726,
      tokensPerSecond: 38,
      uptimePercent: 86.1,
    },
  ],
};

function renderPanel(
  overrides: Partial<Parameters<typeof ModelSettings>[0]> = {},
) {
  const onSelectModel = vi.fn(async () => {});
  const props = {
    settings: connected,
    onClose: () => undefined,
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
      expect(onSelectModel).toHaveBeenCalledWith("z-ai/glm-5.3-flash", [
        "crusoe/fp4",
        "relace/fp4",
      ]),
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

  it("refuses an upstream that cannot run tools", async () => {
    renderPanel();

    expect(
      await screen.findByRole("checkbox", { name: "Z.AI" }),
    ).toBeDisabled();
    expect(screen.getByText("No tool use")).toBeVisible();
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

  it("offers to add a key, and lists nothing, when no key is stored", async () => {
    renderPanel({
      settings: {
        ...connected,
        credential: { status: "missing", source: "none" },
      },
    });

    expect(
      screen.getAllByRole("button", { name: "Add a key" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByLabelText("Search models")).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Add a key" })[0]!);

    expect(
      await screen.findByRole("dialog", { name: "OpenRouter API key" }),
    ).toBeVisible();
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

    fireEvent.click(screen.getAllByRole("button", { name: "Add a key" })[0]!);
    fireEvent.change(await screen.findByLabelText("Paste your key"), {
      target: { value: "sk-or-v1-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() =>
      expect(onSaveApiKey).toHaveBeenCalledWith("sk-or-v1-secret"),
    );
    expect(screen.queryByDisplayValue("sk-or-v1-secret")).toBeNull();
  });

  /**
   * A model the provider has stopped offering is still the stored choice, and
   * the page is where that is discovered. Saying nothing leaves a person
   * looking at a working-looking settings page and an app that fails on every
   * turn, with nothing connecting the two.
   */
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

    fireEvent.click(screen.getByRole("button", { name: "OpenRouter API key" }));

    expect(
      await screen.findByText(
        "The key comes from the development environment, so it cannot be changed here.",
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText("Paste your key")).toBeNull();
  });
});
