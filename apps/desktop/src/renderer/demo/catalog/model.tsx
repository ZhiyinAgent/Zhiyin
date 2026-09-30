import { createWorkspaceState } from "../../ui/app/index.js";
import { EvidencePanel } from "../../ui/evidence/index.js";
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
        <UsagePanel availability={demoUsage} onClose={() => undefined} />
      </div>
    ),
  },
  {
    id: "private-evidence",
    title: "Private evidence and recovery",
    description:
      "Local correction history, recovery usage, retention limits, and explicit deletion.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-feature-surface--page">
        <EvidencePanel
          onClose={() => undefined}
          read={async () => ({
            corrections: {
              retainedEntries: 3,
              shownEntries: 3,
              maximumEntries: 5000,
              entries: [
                {
                  at: "2026-09-13T08:12:00.000Z",
                  taskId: "catalog-task",
                  taskTitle: "Prepare a report",
                  toolName: "run_python",
                  kind: "quiet-retry",
                  reason:
                    "The call arrived with its arguments encoded twice and was sent again.",
                },
                {
                  at: "2026-09-13T08:41:00.000Z",
                  taskId: "catalog-task",
                  taskTitle: "Prepare a report",
                  toolName: "read_file",
                  kind: "repair-applied",
                  reason:
                    "The path was given relative to the wrong folder and was rewritten.",
                  before: '{ "path": "notes/summary.md" }',
                  after: '{ "path": "report/notes/summary.md" }',
                },
                {
                  at: "2026-09-13T09:00:00.000Z",
                  taskId: "catalog-task",
                  taskTitle: "Prepare a report",
                  toolName: "write_file",
                  kind: "repair-rejected",
                  reason: "The proposed repair changed approved content.",
                  cause: "content-changed",
                  before: '{ "path": "report/summary.md", "text": "…" }',
                  after: '{ "path": "report/summary.md", "text": "… (2)" }',
                },
              ],
            },
            recovery: {
              usedBytes: 61_204_480,
              retainedFiles: 24,
              excludedFiles: 1,
              limits: {
                totalBytes: 256 * 1024 * 1024,
                fileBytes: 10 * 1024 * 1024,
                versionsPerPath: 10,
                maximumAgeDays: 30,
              },
            },
            policy: {
              taskDeletion:
                "Deleting a conversation deletes its saved transcript and derived context.",
              correctionRedaction:
                "Common credential fields are removed; arbitrary sensitive text cannot be detected reliably.",
              privateStorage:
                "Private evidence stays on this computer and outside usage telemetry.",
            },
          })}
          clear={async () => {
            throw new Error("Deletion is disabled in the component catalog.");
          }}
        />
      </div>
    ),
  },
];
