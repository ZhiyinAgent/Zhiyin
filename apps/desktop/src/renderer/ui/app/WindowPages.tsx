/**
 * The pages that open over the conversation: the library, usage, settings,
 * memory and preferences. One at a time, each drawn by the module that owns it; what belongs here is
 * only which one is open and what it is handed.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { defaultWorkPauses, type CoreApi } from "@zhiyin/contract";
import { CapabilityLibrary } from "../capabilities/index.js";
import {
  ModelSettings,
  ReviewerModelPage,
  useReviewerLabel,
} from "../model/index.js";
import { UsagePanel } from "../usage/index.js";
import { MemoryPage } from "../memory/index.js";
import { useUndoBudget } from "../settings/index.js";
import { SettingsWithModelList } from "./SettingsWithModelList.js";
import { listedConversations, type WindowState } from "./windowState.js";
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
  | "cancelToolchainInstall"
  | ConnectionCommands
  | "shellAvailability"
  | "recheckShell"
  | "openExternalUrl"
  | "listProviders"
  | "listModels"
  | "listModelProviders"
  | "selectModel"
  | "modelList"
  | "checkModelList"
  | "setModelListUpdates"
  | "saveProviderApiKey"
  | "clearProviderApiKey"
  | "changeMemory"
  | "selectTask"
> &
  Partial<
    Pick<
      CoreApi,
      | "setNotifications"
      | "setStudioReviews"
      | "setReviewerModel"
      | "reviewerModelSettings"
      | "setWorkPauses"
      | "undoBudget"
      | "setUndoBudget"
      | "setMcpServerToolTreatment"
      | "openDataFolder"
      | "openMemoryFolder"
      | "setAppearance"
      | "setLook"
      | "setSpelling"
      | "checkForAppUpdate"
      | "setAppUpdateChecks"
      | "restartToUpdate"
    >
  >;

/**
 * A page under the top bar. The bar is the shell's, not the page's: it is what
 * the window is dragged by and what the window controls sit on, so a page
 * scrolls below it and never under them.
 */
function Surface({ children }: { children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  // What opened the page went with what it replaced, so focus starts at the
  // page's heading; a dialog the page opened on keeps it, and so does the
  // place in the page it opened at.
  useEffect(() => {
    if (document.querySelector('[aria-modal="true"]')) return;
    if (surface.current?.contains(document.activeElement)) return;
    surface.current?.querySelector<HTMLElement>("h1")?.focus();
  }, []);
  return (
    <div className={styles["window-page"]} ref={surface}>
      <div className={styles["top-bar"]} />
      {children}
    </div>
  );
}

export function WindowPages({
  state,
  commands,
  onOpenSurface,
  onStartWith,
  onUpdateConversations,
}: {
  state: WindowState;
  commands: SurfaceCommands;
  onOpenSurface: (surface: WindowState["surface"]) => void;
  /** Starts a new conversation with these words in its message, unsent. */
  onStartWith: (text: string) => void;
  /** Asks about conversations waiting for an update; absent while none is. */
  onUpdateConversations?: (() => void) | undefined;
}) {
  const reviewerLabel = useReviewerLabel(
    state.surface === "settings" ? state.reviewerModel : undefined,
    commands.reviewerModelSettings,
  );
  const undo = useUndoBudget(
    state.surface === "settings" ? commands.undoBudget : undefined,
    commands.setUndoBudget,
  );
  const memoryEntry =
    typeof state.surfaceAt === "number" ? state.surfaceAt : undefined;
  const pluginAt =
    typeof state.surfaceAt === "object" ? state.surfaceAt.plugin : undefined;
  return (
    <>
      {state.surface === "library" && (
        <Surface>
          <CapabilityLibrary
            // Opened again at another plugin, it starts there.
            key={pluginAt ?? "library"}
            opening={pluginAt}
            plugins={state.plugins}
            mcpServers={state.mcpServers}
            loading={state.pluginDirectory === "loading"}
            pluginActions={{
              toggle: commands.setPluginEnabled,
              install: commands.installPlugin,
              update: commands.updatePlugin,
              rollback: commands.rollbackPlugin,
              remove: commands.removePlugin,
              create: commands.createPlugin,
              editableContents: commands.editablePluginContents,
              saveContents: commands.savePluginContents,
            }}
            componentActions={{
              toggle: commands.setComponentEnabled,
              content: commands.componentContent,
              override: commands.overrideComponent,
              reset: commands.resetComponent,
              installToolchain: commands.installToolchain,
              cancelToolchainInstall: commands.cancelToolchainInstall,
            }}
            connectionActions={{
              test: commands.testMcpConnection,
              setToolEnabled: commands.setMcpServerToolEnabled,
              setToolTreatment: commands.setMcpServerToolTreatment,
              saveToken: commands.saveMcpServerToken,
              clearToken: commands.clearMcpServerToken,
              signIn: commands.signInToMcpServer,
              cancelSignIn: commands.cancelMcpSignIn,
              refresh: commands.refreshConnections,
              check: commands.checkMcpConnection,
            }}
            shellChecks={{
              check: commands.shellAvailability,
              recheck: commands.recheckShell,
            }}
            onOpenExternalUrl={commands.openExternalUrl}
            onTryPrompt={onStartWith}
            onClose={() => onOpenSurface("thread")}
          />
        </Surface>
      )}

      {state.surface === "usage" && (
        <Surface>
          <UsagePanel
            availability={state.usage}
            conversations={listedConversations(state)}
            onListModels={commands.listModels}
            onOpenConversation={(id) => {
              onOpenSurface("thread");
              void commands.selectTask(id);
            }}
            onClose={() => onOpenSurface("thread")}
          />
        </Surface>
      )}

      {state.surface === "model" && (
        <Surface>
          <ModelSettings
            settings={state.provider}
            onClose={() => onOpenSurface("thread")}
            onListProviders={commands.listProviders}
            onListModels={(target) => commands.listModels(target)}
            onListModelProviders={(model, target) =>
              commands.listModelProviders(model, target)
            }
            onSelectModel={(model, providers, target) =>
              commands.selectModel(model, providers, target)
            }
            onSaveApiKey={(apiKey, target) =>
              commands.saveProviderApiKey(apiKey, target)
            }
            onClearApiKey={(target) => commands.clearProviderApiKey(target)}
            onOpenExternalUrl={commands.openExternalUrl}
            modelList={{
              state: commands.modelList,
              check: commands.checkModelList,
              setUpdates: commands.setModelListUpdates,
            }}
            openKeyDialog={state.surfaceAt === "apiKey"}
          />
        </Surface>
      )}

      {state.surface === "reviewerModel" &&
        commands.setReviewerModel &&
        commands.reviewerModelSettings && (
          <Surface>
            <ReviewerModelPage
              conversation={state.provider}
              onReadReviewer={commands.reviewerModelSettings}
              onChooseReviewer={commands.setReviewerModel}
              onClose={() => onOpenSurface("settings")}
              onListProviders={commands.listProviders}
              onListModels={(target) => commands.listModels(target)}
              onListModelProviders={(model, target) =>
                commands.listModelProviders(model, target)
              }
              onSaveApiKey={(apiKey, target) =>
                commands.saveProviderApiKey(apiKey, target)
              }
              onClearApiKey={(target) => commands.clearProviderApiKey(target)}
              onOpenExternalUrl={commands.openExternalUrl}
              modelList={{
                state: commands.modelList,
                check: commands.checkModelList,
                setUpdates: commands.setModelListUpdates,
              }}
            />
          </Surface>
        )}

      {state.surface === "settings" && (
        <Surface>
          <SettingsWithModelList
            list={{
              state: commands.modelList,
              check: commands.checkModelList,
              setUpdates: commands.setModelListUpdates,
            }}
            notifications={state.notifications !== "off"}
            appearance={state.appearance ?? "system"}
            onAppearance={commands.setAppearance}
            look={state.look}
            onLook={commands.setLook}
            spelling={state.spelling}
            onSpelling={commands.setSpelling}
            onNotifications={commands.setNotifications}
            workPauses={state.workPauses ?? defaultWorkPauses}
            studioReviews={state.studioReviews !== "off"}
            onStudioReviews={commands.setStudioReviews}
            reviewerModel={reviewerLabel}
            {...(commands.setReviewerModel && commands.reviewerModelSettings
              ? {
                  onChooseReviewerModel: () => onOpenSurface("reviewerModel"),
                  onUseConversationModel: async () => {
                    await commands.setReviewerModel?.(null);
                  },
                }
              : {})}
            onWorkPauses={commands.setWorkPauses}
            onOpenDataFolder={commands.openDataFolder}
            undoBudget={undo.budget}
            onUndoBudget={undo.save}
            {...(onUpdateConversations
              ? {
                  waitingForUpdate: listedConversations(state).filter(
                    (item) => item.needsUpdate,
                  ).length,
                  onUpdateConversations,
                }
              : {})}
            {...(state.appUpdate && commands.setAppUpdateChecks
              ? {
                  appUpdate: state.appUpdate,
                  onAppUpdateChecks: async (enabled: boolean) => {
                    await commands.setAppUpdateChecks?.(enabled);
                  },
                }
              : {})}
            onCheckForAppUpdate={
              commands.checkForAppUpdate &&
              (async () => {
                await commands.checkForAppUpdate?.();
              })
            }
            onRestartToUpdate={commands.restartToUpdate}
            onClose={() => onOpenSurface("thread")}
          />
        </Surface>
      )}

      {state.surface === "memory" && (
        <Surface>
          <MemoryPage
            // Opened again at another entry, it starts there.
            key={memoryEntry ?? "memory"}
            opening={memoryEntry}
            memory={state.memory}
            failure={state.memoryFailure}
            onChange={(request) => commands.changeMemory(request)}
            onOpenFolder={commands.openMemoryFolder}
            onClose={() => onOpenSurface("thread")}
          />
        </Surface>
      )}
    </>
  );
}
