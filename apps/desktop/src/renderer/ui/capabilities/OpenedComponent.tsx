import type {
  AuthoredPluginContents,
  ComponentContent,
  ComponentContentDraft,
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
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

/** What an opened component can change, each by the full id of its subject. */
export type OpenedActions = {
  onSavePluginContents: (
    id: string,
    contents: AuthoredPluginContents,
  ) => Promise<void>;
  onOverrideComponent: (
    id: string,
    content: ComponentContentDraft,
  ) => Promise<void>;
  onResetComponent: (id: string) => Promise<void>;
  onTestConnection: (
    server: McpServerDefinition,
    token?: string,
  ) => Promise<McpConnectionTestOutcome>;
  onSetConnectionToolEnabled: (
    id: string,
    toolName: string,
    enabled: boolean,
  ) => Promise<void>;
  onSaveConnectionToken: (id: string, token: string) => Promise<void>;
  onClearConnectionToken: (id: string) => Promise<void>;
  onSignInToConnection: (id: string) => Promise<McpSignInOutcome>;
  onCancelConnectionSignIn: (id: string) => Promise<void>;
  /** Reaches one configured connector now and says how it answered. */
  onCheckConnection: (id: string) => Promise<McpServerState>;
  onOpenExternalUrl: (url: string) => Promise<void>;
};

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
  actions,
  onInstall,
  onClose,
}: {
  opened: Opened;
  /** The plugin on the page, whose components are read as they are now. */
  plugin: PluginState | undefined;
  mcpServers: readonly McpServerState[];
  actions: OpenedActions;
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
        onSave={(draft) =>
          actions.onOverrideComponent(opened.content.id, draft)
        }
        onReset={() => actions.onResetComponent(opened.content.id)}
        onClose={onClose}
      />
    );
  if (opened.mode === "connector") {
    const id = opened.component.id;
    const current =
      plugin?.components.find((component) => component.id === id) ??
      opened.component;
    return (
      <ConnectorSettings
        component={current}
        server={mcpServers.find((server) => server.id === id)}
        onTest={actions.onTestConnection}
        onCheck={actions.onCheckConnection}
        onSaveToken={(token) => actions.onSaveConnectionToken(id, token)}
        onClearToken={() => actions.onClearConnectionToken(id)}
        onSignIn={() => actions.onSignInToConnection(id)}
        onCancelSignIn={() => actions.onCancelConnectionSignIn(id)}
        onSetToolEnabled={(tool, enabled) =>
          actions.onSetConnectionToolEnabled(id, tool, enabled)
        }
        onOpenExternalUrl={actions.onOpenExternalUrl}
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
        await actions.onSavePluginContents(
          opened.pluginId,
          nextContents(opened.contents, opened.localId, saved),
        );
        // Reached at once, so the list says whether it connected or what
        // it still needs, without a test before saving.
        if (saved.kind === "connection")
          void actions
            .onCheckConnection(fullId(saved.id))
            .catch(() => undefined);
      }}
      {...(opened.localId !== undefined
        ? {
            onRemove: () =>
              actions.onSavePluginContents(
                opened.pluginId,
                nextContents(opened.contents, opened.localId, undefined),
              ),
          }
        : {})}
      {...(draft.kind === "connection"
        ? {
            onTest: actions.onTestConnection,
            onSaveToken: (localId: string, token: string) =>
              actions.onSaveConnectionToken(fullId(localId), token),
            onSetToolEnabled: (toolName: string, enabled: boolean) =>
              actions.onSetConnectionToolEnabled(
                fullId(draft.id),
                toolName,
                enabled,
              ),
            onSignIn: (localId: string) =>
              actions.onSignInToConnection(fullId(localId)),
            onCancelSignIn: (localId: string) =>
              actions.onCancelConnectionSignIn(fullId(localId)),
            onSignOut: (localId: string) =>
              actions.onClearConnectionToken(fullId(localId)),
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
