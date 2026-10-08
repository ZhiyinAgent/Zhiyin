import { createWorkspaceState } from "../../ui/app/index.js";
import { ModelSettings } from "../../ui/model/index.js";
import { UsagePanel } from "../../ui/usage/index.js";
import { demoCatalog, demoProviders, demoUsage } from "../fixtures.js";
import type { ComponentCatalogEntry } from "./entry.js";

export const modelEntries: ComponentCatalogEntry[] = [
  {
    id: "model-settings",
    title: "Model and providers",
    description:
      "Choosing a model, then the upstreams that may serve it, against a live catalogue.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface">
        <ModelSettings
          settings={createWorkspaceState().provider}
          onClose={() => undefined}
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
            providers: [],
            endpoint: "https://openrouter.ai/api/v1/chat/completions",
            credential: { status: "configured", source: "credentialStore" },
          }}
          onClose={() => undefined}
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
            model: "z-ai/glm-4.9-retired",
            providers: [],
            endpoint: "https://openrouter.ai/api/v1/chat/completions",
            credential: { status: "configured", source: "credentialStore" },
          }}
          onClose={() => undefined}
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
];
