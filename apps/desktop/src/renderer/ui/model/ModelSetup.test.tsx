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
  ProviderSettings,
  ProviderSummary,
} from "@zhiyin/contract";
import { ModelSetup } from "./ModelSetup.js";
import { ModelStep } from "./ModelStep.js";

const pages = {
  keys: "https://openrouter.ai/settings/keys",
  billing: "https://openrouter.ai/settings/credits",
};

/** Nothing chosen yet: the window's fallback before a person sets anything. */
const fresh: ProviderSettings = {
  provider: { id: "openrouter", name: "OpenRouter", upstreams: true, pages },
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  credential: { status: "missing", source: "none" },
};

const providers = (keySaved: boolean): readonly ProviderSummary[] => [
  {
    id: "openrouter",
    name: "OpenRouter",
    upstreams: true,
    accounts: [
      {
        credential: keySaved
          ? { status: "configured", source: "credentialStore" }
          : { status: "missing", source: "none" },
        pages,
      },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    unavailable: "Not checked against this lab yet.",
    accounts: [
      {
        credential: { status: "missing", source: "none" },
        pages: { keys: "https://mistral.ai/keys", billing: "" },
      },
    ],
  },
];

const catalog: ModelCatalog = {
  status: "ready",
  models: [
    {
      id: "anthropic/claude-sonnet-5",
      name: "Anthropic: Claude Sonnet 5",
      contextWindow: 1_000_000,
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 10,
      acceptsImages: true,
      reasoning: true,
    },
    {
      id: "z-ai/glm-5.3-flash",
      name: "Z.ai: GLM 5.3 Flash",
      contextWindow: 1_310_720,
      inputUsdPerMillion: 0.075,
      outputUsdPerMillion: 0.25,
      acceptsImages: true,
      reasoning: true,
    },
  ],
};

function setUp(
  more: Partial<Parameters<typeof ModelSetup>[0]> & { keySaved?: boolean } = {},
) {
  let keySaved = more.keySaved ?? false;
  const commands = {
    onListProviders: vi.fn(async () => providers(keySaved)),
    onListModels: vi.fn(async () => catalog),
    onSaveApiKey: vi.fn(async () => {
      keySaved = true;
      return { status: "accepted" as const };
    }),
    onSelectModel: vi.fn(async () => {}),
    onOpenExternalUrl: vi.fn(async () => {}),
  };
  const props = { settings: fresh, ...commands, ...more };
  render(<ModelSetup {...props} />);
  return { ...commands, ...more };
}

describe("setting up a model", () => {
  it("asks for the provider, then its key, then a model, and lists no model before the key", async () => {
    const { onListModels, onOpenExternalUrl } = setUp();
    const setup = screen.getByRole("region", { name: "Connect an AI model" });

    const provider = await within(setup).findByRole("combobox", {
      name: "Provider",
    });
    expect(provider).toHaveValue("openrouter");
    expect(
      within(provider).getByRole("option", { name: /Mistral/ }),
    ).toBeDisabled();
    expect(within(setup).getByLabelText("Key")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      within(setup).getByText(
        "OpenRouter’s models are listed once its key is saved.",
      ),
    ).toBeVisible();
    expect(onListModels).not.toHaveBeenCalled();

    fireEvent.click(
      within(setup).getByRole("button", {
        name: "No key yet? Get one on OpenRouter",
      }),
    );
    expect(onOpenExternalUrl).toHaveBeenCalledWith(pages.keys);
  });

  it("saves the key for the provider shown, never shows it again, and then lists its models", async () => {
    const { onSaveApiKey, onListModels } = setUp();

    fireEvent.change(await screen.findByLabelText("Key"), {
      target: { value: "sk-or-v1-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() =>
      expect(onSaveApiKey).toHaveBeenCalledWith("sk-or-v1-secret", {
        provider: "openrouter",
      }),
    );
    expect(await screen.findByText("Key saved for OpenRouter.")).toBeVisible();
    expect(screen.queryByDisplayValue("sk-or-v1-secret")).toBeNull();
    expect(
      await screen.findByRole("radio", { name: /Claude Sonnet 5/ }),
    ).toBeVisible();
    expect(onListModels).toHaveBeenCalledWith({ provider: "openrouter" });
  });

  it("says why a key was refused and keeps it out of the list of models", async () => {
    setUp({
      onSaveApiKey: async () => ({
        status: "refused" as const,
        reason: "OpenRouter did not accept this key.",
      }),
    });

    fireEvent.change(await screen.findByLabelText("Key"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "OpenRouter did not accept this key.",
    );
    expect(screen.queryByRole("radiogroup", { name: "Models" })).toBeNull();
  });

  it("uses the model chosen at once, on the provider shown, recommending none", async () => {
    const onChosen = vi.fn();
    const { onSelectModel } = setUp({ keySaved: true, onChosen });

    const models = await screen.findByRole("radiogroup", { name: "Models" });
    expect(
      within(models)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("aria-checked")),
    ).toEqual(["false", "false"]);
    expect(screen.queryByText(/recommend/i)).toBeNull();

    fireEvent.click(within(models).getByRole("radio", { name: /GLM 5.3/ }));

    await waitFor(() =>
      expect(onSelectModel).toHaveBeenCalledWith("z-ai/glm-5.3-flash", [], {
        provider: "openrouter",
      }),
    );
    await waitFor(() => expect(onChosen).toHaveBeenCalledOnce());
    expect(
      within(models).getByRole("radio", { name: /GLM 5.3/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("says when the choice could not be used, and leaves it unchosen", async () => {
    const onChosen = vi.fn();
    setUp({
      keySaved: true,
      onChosen,
      onSelectModel: async () => {
        throw new Error("refused");
      },
    });

    fireEvent.click(await screen.findByRole("radio", { name: /GLM 5.3/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The model could not be chosen. Try again.",
    );
    expect(onChosen).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /GLM 5.3/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

describe("onboarding's model step", () => {
  function step() {
    const steps = {
      onBack: vi.fn(),
      onContinue: vi.fn(),
      onLater: vi.fn(),
    };
    render(
      <ModelStep
        label="STEP 2 OF 3"
        settings={fresh}
        onListProviders={async () => providers(true)}
        onListModels={async () => catalog}
        onSaveApiKey={async () => ({ status: "accepted" as const })}
        onSelectModel={async () => {}}
        {...steps}
      />,
    );
    return steps;
  }

  it("keeps Continue off until a model is chosen, and lets the person set it up later", async () => {
    const { onContinue, onLater, onBack } = step();

    expect(
      screen.getByRole("heading", { name: "Connect an AI model" }),
    ).toBeVisible();
    expect(screen.getByText("STEP 2 OF 3")).toBeVisible();
    const next = screen.getByRole("button", { name: "Continue" });
    expect(next).toBeDisabled();
    expect(next).toHaveAttribute("data-tip", "Choose a model first");

    fireEvent.click(await screen.findByRole("radio", { name: /GLM 5.3/ }));
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    expect(onContinue).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Set up later" }));
    expect(onLater).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
