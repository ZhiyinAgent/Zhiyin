import type {
  AuthoredPluginContents,
  ComponentContent,
  ConnectionToolTreatment,
  McpServerState,
  PluginComponentState,
  PluginState,
} from "@zhiyin/contract";
import { Dialog } from "../shared/index.js";
import { ComponentEditor } from "./ComponentEditor.js";
import { ConnectorSettings } from "./ConnectorSettings.js";
import {
  draftFromContents,
  holderOf,
  nextContents,
} from "./componentDrafts.js";
import type {
  ComponentActions,
  ConnectionActions,
  PluginActions,
} from "./libraryActions.js";
import { ToolchainInstallDialog } from "./ToolchainInstallDialog.js";
import { OverrideEditor } from "./OverrideEditor.js";

/** What is open over the page, if anything. */
export type Opened =
  | {
      readonly mode: "authored";
      readonly pluginId: string;
      readonly localId: string | undefined;
      readonly kind: PluginComponentState["kind"];
      readonly contents: AuthoredPluginContents;
    }
  | { readonly mode: "override"; readonly content: ComponentContent }
  | { readonly mode: "connector"; readonly component: PluginComponentState }
  | { readonly mode: "install"; readonly component: PluginComponentState }
  | { readonly mode: "error"; readonly message: string };

/**
 * The dialog for what was opened from a plugin's page: the editor of a
 * component made in the app, the override of one that was imported, a
 * connector's settings, the question before an installation, or why the
 * component could not be opened.
 */
export function OpenedComponent({
  opened,
  plugin,
  mcpServers,
  pluginActions,
  componentActions,
  connectionActions,
  onOpenExternalUrl,
  onInstall,
  onClose,
}: {
  opened: Opened;
  /** The plugin on the page, whose components are read as they are now. */
  plugin: PluginState | undefined;
  mcpServers: readonly McpServerState[];
  pluginActions: Pick<PluginActions, "saveContents">;
  componentActions: Pick<ComponentActions, "override" | "reset">;
  connectionActions: ConnectionActions;
  onOpenExternalUrl: (url: string) => Promise<void>;
  /** Installs what the component with this id needs, once the person agrees. */
  onInstall: (id: string) => void;
  onClose: () => void;
}) {
  if (opened.mode === "error")
    return (
      <Dialog title="Could not open this component" onClose={onClose}>
        <p role="alert">{opened.message}</p>
      </Dialog>
    );
  if (opened.mode === "override")
    return (
      <OverrideEditor
        content={opened.content}
        onSave={(draft) => componentActions.override(opened.content.id, draft)}
        onReset={() => componentActions.reset(opened.content.id)}
        onClose={onClose}
      />
    );
  const { setToolTreatment } = connectionActions;
  if (opened.mode === "connector") {
    const id = opened.component.id;
    const current =
      plugin?.components.find((component) => component.id === id) ??
      opened.component;
    return (
      <ConnectorSettings
        component={current}
        server={mcpServers.find((server) => server.id === id)}
        onTest={connectionActions.test}
        onCheck={connectionActions.check}
        onSaveToken={(token) => connectionActions.saveToken(id, token)}
        onClearToken={() => connectionActions.clearToken(id)}
        onSignIn={() => connectionActions.signIn(id)}
        onCancelSignIn={() => connectionActions.cancelSignIn(id)}
        onSetToolEnabled={(tool, enabled) =>
          connectionActions.setToolEnabled(id, tool, enabled)
        }
        onSetToolTreatment={
          setToolTreatment &&
          ((tool, treatment, shown) =>
            setToolTreatment(id, tool, treatment, shown))
        }
        onOpenExternalUrl={onOpenExternalUrl}
        onClose={onClose}
      />
    );
  }
  if (opened.mode === "install")
    return (
      <ToolchainInstallDialog
        component={opened.component}
        onClose={onClose}
        onInstall={() => onInstall(opened.component.id)}
      />
    );
  const draft = draftFromContents(opened.contents, opened.localId, opened.kind);
  if (!draft)
    return (
      <Dialog title="Could not open this component" onClose={onClose}>
        <p role="alert">This component no longer exists.</p>
      </Dialog>
    );
  const fullId = (localId: string) => `${opened.pluginId}/${localId}`;
  const localId = opened.localId;
  const server =
    localId !== undefined
      ? mcpServers.find((item) => item.id === fullId(localId))
      : undefined;
  return (
    <ComponentEditor
      draft={draft}
      holderOf={(localId) =>
        localId === opened.localId
          ? undefined
          : holderOf(opened.contents, localId)
      }
      onClose={onClose}
      onSave={async (saved) => {
        await pluginActions.saveContents(
          opened.pluginId,
          nextContents(opened.contents, opened.localId, saved),
        );
        // Reached at once, so the list says whether it connected or what
        // it still needs, without a test before saving.
        if (saved.kind === "connection")
          void connectionActions.check(fullId(saved.id)).catch(() => undefined);
      }}
      onRemove={
        opened.localId === undefined
          ? undefined
          : () =>
              pluginActions.saveContents(
                opened.pluginId,
                nextContents(opened.contents, opened.localId, undefined),
              )
      }
      {...(draft.kind === "connection"
        ? {
            onTest: connectionActions.test,
            onSaveToken: (localId: string, token: string) =>
              connectionActions.saveToken(fullId(localId), token),
            onSetToolEnabled: (
              localId: string,
              toolName: string,
              enabled: boolean,
            ) =>
              connectionActions.setToolEnabled(
                fullId(localId),
                toolName,
                enabled,
              ),
            ...(setToolTreatment
              ? {
                  onSetToolTreatment: (
                    toolName: string,
                    treatment: ConnectionToolTreatment,
                    shown: string,
                  ) =>
                    setToolTreatment(
                      fullId(draft.id),
                      toolName,
                      treatment,
                      shown,
                    ),
                }
              : {}),
            onSignIn: (localId: string) =>
              connectionActions.signIn(fullId(localId)),
            onCancelSignIn: (localId: string) =>
              connectionActions.cancelSignIn(fullId(localId)),
            onSignOut: (localId: string) =>
              connectionActions.clearToken(fullId(localId)),
            ...(server
              ? {
                  connectionState: {
                    status: server.status,
                    tools: server.tools,
                    tokenSaved: server.credential.status === "saved",
                    ...(server.credential.status === "signed-in"
                      ? { account: "signed-in" as const }
                      : server.signIn
                        ? { account: "signed-out" as const }
                        : {}),
                  },
                }
              : {}),
          }
        : {})}
    />
  );
}
