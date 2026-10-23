import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ModelCatalog,
  ModelListState,
  ProviderSettings,
} from "@zhiyin/contract";
import { ModelSettings } from "./ModelSettings.js";

/**
 * The Model page says where the labs' models and prices come from (ADR 0031):
 * Zhiyin's list in force and its day, a look for a newer one each time the
 * page opens, and a switch that stops Zhiyin asking GitHub at all.
 */

const onDeepSeek: ProviderSettings = {
  provider: {
    id: "deepseek",
    name: "DeepSeek",
    region: { id: "international", name: "International" },
    pages: {
      keys: "https://platform.deepseek.com/api_keys",
      billing: "https://platform.deepseek.com/",
    },
  },
  model: "deepseek-flash",
  providers: [],
  endpoint: "https://api.deepseek.com/chat/completions",
  credential: { status: "configured", source: "credentialStore" },
};

const catalog: ModelCatalog = {
  status: "ready",
  models: [
    {
      id: "deepseek-flash",
      name: "DeepSeek V4.1 Flash",
      contextWindow: 1_048_576,
      acceptsImages: true,
      reasoning: true,
    },
  ],
};

const shipped: ModelListState = {
  source: "shipped",
  version: 1,
  published: "2026-10-22",
  updates: true,
};

const downloaded: ModelListState = {
  source: "downloaded",
  version: 2,
  published: "2026-11-03",
  updates: true,
  lastCheck: { at: "2026-11-04T09:00:00.000Z", outcome: "updated" },
};

function page(list: {
  state: () => Promise<ModelListState>;
  check: () => Promise<ModelListState>;
  setUpdates: (enabled: boolean) => Promise<ModelListState>;
}) {
  const onListModels = vi.fn(async () => catalog);
  render(
    <ModelSettings
      settings={onDeepSeek}
      onClose={() => undefined}
      onListProviders={async () => []}
      onListModels={onListModels}
      onListModelProviders={async (model) => ({
        status: "ready",
        model,
        providers: [],
      })}
      onSelectModel={async () => {}}
      onSaveApiKey={async () => ({ status: "accepted" })}
      onClearApiKey={async () => {}}
      modelList={list}
    />,
  );
  return { onListModels };
}

describe("where the Model page's models and prices come from", () => {
  it("names the list in force and its day, looks for a newer one, and lists the models again from it", async () => {
    let finishLook: (state: ModelListState) => void = () => {};
    const { onListModels } = page({
      state: async () => shipped,
      check: () =>
        new Promise((resolve) => {
          finishLook = resolve;
        }),
      setUpdates: async () => shipped,
    });

    expect(
      await screen.findByText(
        /list of October 22, 2026, shipped with this version/,
      ),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking for a newer list…",
    );
    await waitFor(() => expect(onListModels).toHaveBeenCalledTimes(1));

    finishLook(downloaded);

    expect(
      await screen.findByText(/list of November 3, 2026, updated from GitHub/),
    ).toBeVisible();
    expect(screen.queryByText("Checking for a newer list…")).toBeNull();
    await waitFor(() => expect(onListModels).toHaveBeenCalledTimes(2));
  });

  it("says why no newer list could be used, keeping the one in force", async () => {
    page({
      state: async () => shipped,
      check: async () => ({
        ...shipped,
        lastCheck: {
          at: "2026-10-22T09:00:00.000Z",
          outcome: "failed",
          reason: "GitHub could not be reached.",
        },
      }),
      setUpdates: async () => shipped,
    });

    expect(
      await screen.findByText(
        /No newer list could be used: GitHub could not be reached\./,
      ),
    ).toBeVisible();
    expect(screen.getByText(/shipped with this version/)).toBeVisible();
  });

  it("asks GitHub nothing while updates are off, and looks once they are turned on", async () => {
    const check = vi.fn(async () => shipped);
    const setUpdates = vi.fn(async (enabled: boolean) => ({
      ...shipped,
      updates: enabled,
    }));
    page({
      state: async () => ({ ...shipped, updates: false }),
      check,
      setUpdates,
    });
    const toggle = await screen.findByRole("switch", {
      name: "Keep models and prices up to date",
    });

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(check).not.toHaveBeenCalled();

    fireEvent.click(toggle);

    await waitFor(() => expect(setUpdates).toHaveBeenCalledWith(true));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
