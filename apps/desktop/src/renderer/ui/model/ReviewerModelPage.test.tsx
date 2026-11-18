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
import { ReviewerModelPage } from "./ReviewerModelPage.js";

const pages = {
  keys: "https://platform.deepseek.com/api_keys",
  billing: "https://platform.deepseek.com/",
};

/** The conversation answers on DeepSeek's mainland platform. */
const conversation: ProviderSettings = {
  provider: {
    id: "deepseek",
    name: "DeepSeek",
    region: { id: "mainland", name: "Mainland China" },
    pages,
  },
  model: "deepseek-chat",
  modelName: "DeepSeek Chat",
  providers: [],
  endpoint: "https://api.deepseek.com/chat/completions",
  credential: { status: "configured", source: "credentialStore" },
};

const catalog: ModelCatalog = {
  status: "ready",
  models: [
    {
      id: "deepseek-chat",
      name: "DeepSeek Chat",
      contextWindow: 1_000_000,
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 1.2,
      acceptsImages: false,
      reasoning: false,
    },
    {
      id: "deepseek-reasoner",
      name: "DeepSeek Reasoner",
      contextWindow: 1_000_000,
      inputUsdPerMillion: 0.6,
      outputUsdPerMillion: 2.4,
      acceptsImages: true,
      reasoning: true,
    },
  ],
};

const listed: readonly ProviderSummary[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    accounts: [
      {
        region: { id: "mainland", name: "Mainland China" },
        credential: { status: "configured", source: "credentialStore" },
        pages,
      },
    ],
  },
];

function renderPage(
  overrides: Partial<Parameters<typeof ReviewerModelPage>[0]> = {},
) {
  const onChooseReviewer = vi.fn(async () => {});
  render(
    <ReviewerModelPage
      conversation={conversation}
      onReadReviewer={async () => null}
      onChooseReviewer={onChooseReviewer}
      onClose={() => undefined}
      onListProviders={async () => listed}
      onListModels={async () => catalog}
      onListModelProviders={async () => ({
        status: "ready",
        model: "",
        providers: [],
      })}
      onSaveApiKey={async () => ({ status: "accepted" as const })}
      onClearApiKey={async () => {}}
      {...overrides}
    />,
  );
  return { onChooseReviewer };
}

describe("choosing the model studio work is reviewed on", () => {
  it("says reviews use the conversation's model until one is chosen, and saves the one chosen for reviews alone", async () => {
    const { onChooseReviewer } = renderPage();

    const current = (await screen.findByText("Reviews use")).parentElement!;
    expect(
      screen.getByRole("heading", { name: "Reviewer model" }),
    ).toBeVisible();
    expect(within(current).getByText("The conversation's model")).toBeVisible();
    expect(within(current).queryByText("DeepSeek · Mainland China")).toBeNull();

    fireEvent.click(
      await screen.findByRole("radio", { name: /DeepSeek Reasoner/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onChooseReviewer).toHaveBeenCalledWith({
        provider: "deepseek",
        region: "mainland",
        model: "deepseek-reasoner",
        providers: [],
      }),
    );
  });

  it("opens on the model chosen for reviews, as its provider reports it", async () => {
    renderPage({
      onReadReviewer: async () => ({
        ...conversation,
        model: "deepseek-reasoner",
        modelName: "DeepSeek Reasoner",
      }),
    });

    const current = (await screen.findByText("Reviews use")).parentElement!;
    expect(await within(current).findByText("DeepSeek Reasoner")).toBeVisible();
    expect(
      within(current).getByText("DeepSeek · Mainland China"),
    ).toBeVisible();
  });

  it("says when what is chosen for reviews cannot be read, and reads it again on request", async () => {
    const onReadReviewer = vi
      .fn<() => Promise<ProviderSettings | null>>()
      .mockRejectedValueOnce(new Error("The keyring is locked."))
      .mockResolvedValueOnce(null);
    renderPage({ onReadReviewer });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The model chosen for reviews could not be read.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Reviews use")).toBeVisible();
    expect(onReadReviewer).toHaveBeenCalledTimes(2);
  });

  it("shows that it is reading before what is chosen for reviews arrives", () => {
    renderPage({ onReadReviewer: () => new Promise(() => {}) });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Reading the model chosen for reviews…",
    );
  });
});
