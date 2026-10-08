/**
 * The pages that open over the conversation: the library, usage and settings.
 * One at a time, each drawn by the module that owns it; what belongs here is
 * only which one is open and what it is handed.
 */

import type { ReactNode } from "react";
import type { CoreApi } from "@zhiyin/contract";
import { CapabilityLibrary } from "../capabilities/index.js";
import { ModelSettings } from "../model/index.js";
import { UsagePanel } from "../usage/index.js";
import { InstructionsSettings } from "../instructions/index.js";
import { AppSettings } from "../settings/index.js";
import { listedConversations, type WorkspaceState } from "./workspaceState.js";
import styles from "./app.module.css";

/** What the plugin library asks of a person's connectors. */
export type ConnectionCommands =
  | "setMcpServerToolEnabled"
  | "testMcpConnection"
  | "saveMcpServerToken"
  | "clearMcpServerToken"
  | "signInToMcpServer"
  | "cancelMcpSignIn"
  | "refreshConnections"
  | "checkMcpConnection";

type SurfaceCommands = Pick<
  CoreApi,
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
  | ConnectionCommands
  | "shellAvailability"
  | "recheckShell"
  | "openExternalUrl"
  | "listModels"
  | "listModelProviders"
  | "selectModel"
  | "saveProviderApiKey"
  | "clearProviderApiKey"
  | "setPersonalInstructions"
  | "selectTask"
> &
  Partial<
    Pick<
      CoreApi,
      "setNotifications" | "openDataFolder" | "setAppearance" | "setSpelling"
    >
  >;

/**
 * A page under the top bar. The bar is the shell's, not the page's: it is what
 * the window is dragged by and what the window controls sit on, so a page
 * scrolls below it and never under them.
 */
function Surface({ children }: { children: ReactNode }) {
  return (
    <div className={styles["workspace-surface"]}>
      <div className={styles["top-bar"]} />
      {children}
    </div>
  );
}

export function WorkspaceSurfaces({
  state,
  commands,
  onOpenSurface,
  openKeyDialog = false,
  onUpdateConversations,
}: {
  state: WorkspaceState;
  commands: SurfaceCommands;
  onOpenSurface: (surface: WorkspaceState["surface"]) => void;
  /** Settings opens on the key dialog. */
  openKeyDialog?: boolean;
  /** Asks about conversations waiting for an update; absent while none is. */
  onUpdateConversations?: () => void;
}) {
  return (
    <>
      {state.surface === "library" && (
        <Surface>
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
            onSignInToConnection={commands.signInToMcpServer}
            onCancelConnectionSignIn={commands.cancelMcpSignIn}
            onRefreshConnections={commands.refreshConnections}
            onCheckConnection={commands.checkMcpConnection}
            onCheckShell={commands.shellAvailability}
            onRecheckShell={commands.recheckShell}
            onOpenExternalUrl={commands.openExternalUrl}
            onClose={() => onOpenSurface("thread")}
          />
        </Surface>
      )}

      {state.surface === "usage" && (
        <Surface>
          <UsagePanel
            availability={state.usage}
            conversations={state.tasks}
            onListModels={commands.listModels}
            onOpenConversation={(id) => {
              onOpenSurface("thread");
              void commands.selectTask(id);
            }}
            onClose={() => onOpenSurface("thread")}
          />
        </Surface>
      )}

      {state.surface === "settings" && (
        <Surface>
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
            onOpenExternalUrl={commands.openExternalUrl}
            openKeyDialog={openKeyDialog}
          />
        </Surface>
      )}

      {state.surface === "preferences" && (
        <Surface>
          <AppSettings
            notifications={state.notifications !== "off"}
            appearance={state.appearance ?? "system"}
            {...(commands.setAppearance
              ? { onAppearance: commands.setAppearance }
              : {})}
            spelling={state.spelling}
            {...(commands.setSpelling
              ? { onSpelling: commands.setSpelling }
              : {})}
            {...(commands.setNotifications
              ? { onNotifications: commands.setNotifications }
              : {})}
            {...(commands.openDataFolder
              ? { onOpenDataFolder: commands.openDataFolder }
              : {})}
            {...(onUpdateConversations
              ? {
                  waitingForUpdate: listedConversations(state).filter(
                    (item) => item.needsUpdate,
                  ).length,
                  onUpdateConversations,
                }
              : {})}
            onClose={() => onOpenSurface("thread")}
          />
        </Surface>
      )}

      {state.surface === "instructions" && (
        <Surface>
          <InstructionsSettings
            saved={state.personalInstructions ?? ""}
            onSave={(text) => commands.setPersonalInstructions(text)}
            onClose={() => onOpenSurface("thread")}
          />
        </Surface>
      )}
    </>
  );
}
