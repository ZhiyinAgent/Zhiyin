import type { ModelListState } from "@zhiyin/contract";
import { createWorkspaceState } from "../../ui/app/index.js";
import { ModelSettings } from "../../ui/model/index.js";
import { UsagePanel } from "../../ui/usage/index.js";
import {
  demoCatalog,
  demoDeepSeekMainland,
  demoLabCatalog,
  demoLabSummaries,
  demoModelList,
  demoModelListDownloaded,
  demoModelListUnreached,
  demoOpenRouter,
  demoProviders,
  demoProviderSummaries,
  demoUsage,
  demoUsageWithEstimates,
} from "../fixtures.js";
import type { ComponentCatalogEntry } from "./entry.js";

/**
 * The model list as the page asks for it: `state` when it opens, then
 * `looked` once a look for a newer one ends, or never for a look still under
 * way.
 */
function modelList(
  state: ModelListState,
  looked: ModelListState | "under way" = state,
) {
  return {
    state: async () => state,
    check: () =>
      looked === "under way"
        ? new Promise<ModelListState>(() => {})
        : Promise.resolve(looked),
    setUpdates: async (updates: boolean) => ({ ...state, updates }),
  };
}

/** The Model page on DeepSeek's mainland platform, with this model list. */
function labPage(list: ReturnType<typeof modelList>) {
  return (
    <div className="lab-feature-surface">
      <ModelSettings
        settings={{
          provider: demoDeepSeekMainland,
          model: "deepseek-v4-pro",
          providers: [],
          endpoint: "https://api.deepseek.com/chat/completions",
          credential: { status: "configured", source: "credentialStore" },
        }}
        onClose={() => undefined}
        onListProviders={async () => demoLabSummaries}
        onListModels={async (target) => demoLabCatalog(target)}
        onListModelProviders={async (model) => ({
          status: "ready",
          model,
          providers: demoProviders,
        })}
        onSelectModel={async () => {}}
        onSaveApiKey={async () => ({ status: "accepted" as const })}
        onClearApiKey={async () => {}}
        onOpenExternalUrl={async () => {}}
        modelList={list}
      />
    </div>
  );
}

export const modelEntries: ComponentCatalogEntry[] = [
  {
    id: "model-settings",
    title: "Model and providers",
    description:
      "Choosing a provider, then a model, then on OpenRouter the upstreams that may serve it, against a live catalogue.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface">
        <ModelSettings
          settings={createWorkspaceState().provider}
          onClose={() => undefined}
          onListProviders={async () => demoProviderSummaries}
          onListModels={async () => demoCatalog}
          onListModelProviders={async (model) => ({
            status: "ready",
            model,
            providers: demoProviders,
          })}
          onSelectModel={async () => {}}
          onSaveApiKey={async () => ({ status: "accepted" as const })}
          onClearApiKey={async () => {}}
          onOpenExternalUrl={async () => {}}
        />
      </div>
    ),
  },
  {
    id: "model-settings-unchosen",
    title: "Model and providers, nothing chosen yet",
    description:
      "A key is stored and no model has been chosen: the page says so, and nothing is sent until one is saved.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface">
        <ModelSettings
          settings={{
            provider: demoOpenRouter,
            providers: [],
            endpoint: "https://openrouter.ai/api/v1/chat/completions",
            credential: { status: "configured", source: "credentialStore" },
          }}
          onClose={() => undefined}
          onListProviders={async () => demoProviderSummaries}
          onListModels={async () => demoCatalog}
          onListModelProviders={async (model) => ({
            status: "ready",
            model,
            providers: demoProviders,
          })}
          onSelectModel={async () => {}}
          onSaveApiKey={async () => ({ status: "accepted" as const })}
          onClearApiKey={async () => {}}
          onOpenExternalUrl={async () => {}}
        />
      </div>
    ),
  },
  {
    id: "model-settings-configured",
    title: "Model and providers, with a key stored",
    description:
      "The same page once a key exists: models to choose from, the upstreams that serve one, and a stored model the catalogue no longer lists — which says so and stays the choice, rather than being quietly replaced by one that does exist.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface">
        <ModelSettings
          settings={{
            provider: demoOpenRouter,
            model: "z-ai/glm-4.9-retired",
            providers: [],
            endpoint: "https://openrouter.ai/api/v1/chat/completions",
            credential: { status: "configured", source: "credentialStore" },
          }}
          onClose={() => undefined}
          onListProviders={async () => demoProviderSummaries}
          onListModels={async () => demoCatalog}
          onListModelProviders={async (model) => ({
            status: "ready",
            model,
            providers: demoProviders,
          })}
          onSelectModel={async () => {}}
          onSaveApiKey={async () => ({ status: "accepted" as const })}
          onClearApiKey={async () => {}}
          onOpenExternalUrl={async () => {}}
        />
      </div>
    ),
  },
  {
    id: "model-settings-lab",
    title: "Model and providers, on a lab",
    description:
      "A lab serves its own models, so beside the list stands the chosen model: its prices on the platform, in that platform's currency, with busy hours or a higher tier where the lab has them, and what it can do.",
    className: "lab-section--feature",
    render: () => labPage(modelList(demoModelList)),
  },
  {
    id: "model-list-checking",
    title: "Model list, looking for a newer one",
    description:
      "Each time the page opens, Zhiyin looks on GitHub for a newer signed list of models and prices, and says so while it looks.",
    className: "lab-section--feature",
    render: () => labPage(modelList(demoModelList, "under way")),
  },
  {
    id: "model-list-downloaded",
    title: "Model list, updated from GitHub",
    description:
      "A newer list was taken: the page names its day and where it came from, and the models and prices above come from it.",
    className: "lab-section--feature",
    render: () => labPage(modelList(demoModelListDownloaded)),
  },
  {
    id: "model-list-unreached",
    title: "Model list, GitHub out of reach",
    description:
      "A look that failed leaves the list in force, and says why no newer one could be used.",
    className: "lab-section--feature",
    render: () => labPage(modelList(demoModelListUnreached)),
  },
  {
    id: "model-list-off",
    title: "Model list, updates off",
    description:
      "With the switch off, Zhiyin keeps the list it has and asks GitHub for nothing.",
    className: "lab-section--feature",
    render: () =>
      labPage(modelList({ ...demoModelListDownloaded, updates: false })),
  },
  {
    id: "usage",
    title: "Usage instruments",
    description: "Real request, model, and cost data rendered visually.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-feature-surface--page">
        <UsagePanel
          availability={demoUsage}
          conversations={[
            { id: "release", title: "Prepare v0.1 release notes" },
            { id: "research", title: "Compare three survey tools" },
          ]}
          onOpenConversation={() => undefined}
          onListModels={async () => demoCatalog}
          onClose={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "usage-empty",
    title: "Usage before any request",
    description: "What the page says until a model request has been made.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-feature-surface--page">
        <UsagePanel
          availability={{
            status: "unavailable",
            reason: "Usage will appear after the first model request.",
          }}
          conversations={[]}
          onOpenConversation={() => undefined}
          onListModels={async () => demoCatalog}
          onClose={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "usage-estimated",
    title: "Usage with estimated costs",
    description:
      "Dollars OpenRouter reported beside yuan estimated from a mainland price list, never converted.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-feature-surface--page">
        <UsagePanel
          availability={demoUsageWithEstimates}
          conversations={[
            { id: "release", title: "Prepare v0.1 release notes" },
            { id: "research", title: "Compare three survey tools" },
            { id: "mainland", title: "Summarise the supplier contracts" },
          ]}
          onOpenConversation={() => undefined}
          onListModels={async () => demoCatalog}
          onClose={() => undefined}
        />
      </div>
    ),
  },
];
