import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ModelCatalog,
  ModelListState,
  ProviderSettings,
} from "@zhiyin/contract";
import { ModelSettings } from "./ModelSettings.js";

/**
 * A newer model list taken while the Model page is open (ADR 0027) brings
 * the models and prices it shows up to date.
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

describe("the Model page and a newer model list", () => {
  it("lists the models again from a newer list taken while it is open", async () => {
    let finishLook: ((state: ModelListState) => void) | undefined;
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
        modelList={{
          state: async () => shipped,
          check: () =>
            new Promise((resolve) => {
              finishLook = resolve;
            }),
          setUpdates: async () => shipped,
        }}
      />,
    );
    await waitFor(() => expect(onListModels).toHaveBeenCalledTimes(1));
    // The look for a newer list starts once the list in force is read.
    await waitFor(() => expect(finishLook).toBeDefined());

    finishLook?.(downloaded);

    await waitFor(() => expect(onListModels).toHaveBeenCalledTimes(2));
  });
});
