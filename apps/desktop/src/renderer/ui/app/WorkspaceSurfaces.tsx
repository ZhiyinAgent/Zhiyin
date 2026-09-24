/**
 * The pages that open over the conversation: the library, usage and settings.
 * One at a time, each drawn by the module that owns it; what belongs here is
 * only which one is open and what it is handed.
 */

import type { CoreApi } from "@zhiyin/contract";
import { CapabilityLibrary } from "../capabilities/index.js";
import { ModelSettings } from "../model/index.js";
import { UsagePanel } from "../usage/index.js";
import { EvidencePanel } from "../evidence/index.js";
import type { WorkspaceState } from "./workspaceState.js";
import styles from "./app.module.css";

type SurfaceCommands = Pick<
  CoreApi,
  | "setDefaultContextBudget"
  | "setPluginEnabled"
  | "installPlugin"
  | "updatePlugin"
  | "rollbackPlugin"
  | "removePlugin"
  | "createPlugin"
  | "savePluginContents"
  | "editablePluginContents"
  | "setComponentEnabled"
  | "componentContent"
  | "overrideComponent"
  | "resetComponent"
  | "installToolchain"
  | "setMcpServerToolEnabled"
  | "testMcpConnection"
  | "saveMcpServerToken"
  | "clearMcpServerToken"
  | "refreshConnections"
  | "shellAvailability"
  | "recheckShell"
  | "openExternalUrl"
  | "listModels"
  | "listModelProviders"
  | "selectModel"
  | "saveProviderApiKey"
  | "clearProviderApiKey"
  | "readEvidence"
  | "clearEvidence"
>;

/**
 * Instructions and tool definitions as last measured: the open conversation's,
 * else the newest one measured. They are near alike across conversations.
 */
function fixedPart(state: WorkspaceState): { fixedTokens?: number } {
  const usage =
    state.tasks.find((task) => task.id === state.selectedTaskId)
      ?.contextUsage ??
    state.tasks.find((task) => task.contextUsage)?.contextUsage;
  return usage
    ? { fixedTokens: usage.parts.instructions + usage.parts.tools }
    : {};
}

export function WorkspaceSurfaces({
  state,
  commands,
  onOpenSurface,
}: {
  state: WorkspaceState;
  commands: SurfaceCommands;
  onOpenSurface: (surface: WorkspaceState["surface"]) => void;
}) {
  return (
    <>
      {state.surface === "library" && (
        <div className={styles["workspace-surface"]}>
          <CapabilityLibrary
            plugins={state.plugins}
            mcpServers={state.mcpServers}
            loading={state.pluginDirectory === "loading"}
            onTogglePlugin={commands.setPluginEnabled}
            onInstallPlugin={commands.installPlugin}
            onUpdatePlugin={commands.updatePlugin}
            onRollbackPlugin={commands.rollbackPlugin}
            onRemovePlugin={commands.removePlugin}
            onCreatePlugin={commands.createPlugin}
            onLoadEditableContents={commands.editablePluginContents}
            onSavePluginContents={commands.savePluginContents}
            onToggleComponent={commands.setComponentEnabled}
            onLoadComponentContent={commands.componentContent}
            onOverrideComponent={commands.overrideComponent}
            onResetComponent={commands.resetComponent}
            onInstallToolchain={commands.installToolchain}
            onTestConnection={commands.testMcpConnection}
            onSetConnectionToolEnabled={commands.setMcpServerToolEnabled}
            onSaveConnectionToken={commands.saveMcpServerToken}
            onClearConnectionToken={commands.clearMcpServerToken}
            onRefreshConnections={commands.refreshConnections}
            onCheckShell={commands.shellAvailability}
            onRecheckShell={commands.recheckShell}
            onOpenExternalUrl={commands.openExternalUrl}
            onClose={() => onOpenSurface("thread")}
          />
        </div>
      )}

      {state.surface === "usage" && (
        <div className={styles["workspace-surface"]}>
          <UsagePanel
            availability={state.usage}
            onClose={() => onOpenSurface("thread")}
          />
        </div>
      )}

      {state.surface === "evidence" && (
        <div className={styles["workspace-surface"]}>
          <EvidencePanel
            read={() => commands.readEvidence()}
            clear={(kind) => commands.clearEvidence(kind)}
            onClose={() => onOpenSurface("thread")}
          />
        </div>
      )}

      {state.surface === "settings" && (
        <div className={styles["workspace-surface"]}>
          <ModelSettings
            settings={state.provider}
            onClose={() => onOpenSurface("thread")}
            onListModels={() => commands.listModels()}
            onListModelProviders={(model) => commands.listModelProviders(model)}
            onSelectModel={(model, providers) =>
              commands.selectModel(model, providers)
            }
            onSaveApiKey={(apiKey) => commands.saveProviderApiKey(apiKey)}
            onClearApiKey={() => commands.clearProviderApiKey()}
            defaultBudget={state.contextBudget ?? "medium"}
            {...fixedPart(state)}
            onSetDefaultBudget={commands.setDefaultContextBudget}
          />
        </div>
      )}
    </>
  );
}
