import { useEffect, useState } from "react";
import type {
  AuthoredPluginContents,
  ComponentContent,
  ComponentContentDraft,
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  PluginComponentState,
  PluginSourceOutcome,
  PluginState,
  ShellAvailability,
} from "@zhiyin/contract";
import { Dialog, Icon, SurfacePanel } from "../shared/index.js";
import { ComponentEditor } from "./ComponentEditor.js";
import { ConnectorSettings } from "./ConnectorSettings.js";
import {
  draftFromContents,
  localIdOf,
  nextContents,
} from "./componentDrafts.js";
import { ToolchainInstallDialog } from "./ToolchainInstallDialog.js";
import { OverrideEditor } from "./OverrideEditor.js";
import { NewPluginDialog } from "./NewPluginDialog.js";
import { PluginDetail } from "./PluginDetail.js";
import styles from "./capabilities.module.css";

/**
 * What a directory row says about its plugin. A fully ready plugin says
 * nothing, so the rows that need a look are the ones that stand out.
 */
function pluginBadge(plugin: PluginState): string | undefined {
  if (plugin.status === "ready") return undefined;
  if (plugin.status === "off") return "Off";
  if (plugin.status === "failed") return "Needs attention";
  return "Needs setup";
}

/** What is open over the page, if anything. */
type Opened =
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

export function CapabilityLibrary({
  plugins = [],
  mcpServers = [],
  loading = false,
  onClose,
  onTogglePlugin,
  onInstallPlugin,
  onUpdatePlugin,
  onRollbackPlugin,
  onRemovePlugin,
  onCreatePlugin,
  onLoadEditableContents,
  onSavePluginContents,
  onToggleComponent,
  onLoadComponentContent,
  onOverrideComponent,
  onResetComponent,
  onInstallToolchain,
  onTestConnection,
  onSetConnectionToolEnabled,
  onSaveConnectionToken,
  onClearConnectionToken,
  onSignInToConnection,
  onCancelConnectionSignIn,
  onRefreshConnections,
  onCheckConnection,
  onCheckShell,
  onRecheckShell,
  onOpenExternalUrl,
}: {
  plugins?: readonly PluginState[];
  mcpServers?: readonly McpServerState[];
  loading?: boolean;
  onClose: () => void;
  onTogglePlugin: (id: string, enabled: boolean) => Promise<void>;
  onInstallPlugin: () => Promise<PluginSourceOutcome>;
  onUpdatePlugin: (id: string) => Promise<PluginSourceOutcome>;
  onRollbackPlugin: (id: string) => Promise<void>;
  onRemovePlugin: (id: string) => Promise<void>;
  onCreatePlugin: (displayName: string, description: string) => Promise<void>;
  onLoadEditableContents: (
    id: string,
  ) => Promise<AuthoredPluginContents | undefined>;
  onSavePluginContents: (
    id: string,
    contents: AuthoredPluginContents,
  ) => Promise<void>;
  onToggleComponent: (id: string, enabled: boolean) => Promise<void>;
  onLoadComponentContent: (id: string) => Promise<ComponentContent | undefined>;
  onOverrideComponent: (
    id: string,
    content: ComponentContentDraft,
  ) => Promise<void>;
  onResetComponent: (id: string) => Promise<void>;
  onInstallToolchain: (id: string) => Promise<void>;
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
  /** Re-checks every connection now, trying failed ones again. */
  onRefreshConnections: () => Promise<void>;
  /** Reaches one configured connector now and says how it answered. */
  onCheckConnection: (id: string) => Promise<McpServerState>;
  /** The current reading, fetched once on open — never cached beyond that. */
  onCheckShell: () => Promise<ShellAvailability>;
  /** Re-detects the shell on request, so an install just now is picked up. */
  onRecheckShell: () => Promise<ShellAvailability>;
  onOpenExternalUrl: (url: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [pendingAction, setPendingAction] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<Opened | undefined>();
  const [shell, setShell] = useState<ShellAvailability | undefined>();
  const [checkingShell, setCheckingShell] = useState(false);

  useEffect(() => {
    let live = true;
    void onCheckShell()
      .then((result) => {
        if (live) setShell(result);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [onCheckShell]);

  async function recheckShell() {
    setCheckingShell(true);
    try {
      setShell(await onRecheckShell());
    } catch {
      // The previous reading stays; the button is there to try again.
    } finally {
      setCheckingShell(false);
    }
  }

  const normalized = query.trim().toLocaleLowerCase();
  const visible = normalized
    ? plugins.filter((plugin) =>
        [plugin.name, plugin.description, plugin.category]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalized),
      )
    : plugins;
  const selected =
    visible.find((plugin) => plugin.id === selectedId) ?? visible[0];

  /** Runs one change, showing its failure on the page instead of losing it. */
  async function attempt(
    name: string | undefined,
    change: () => Promise<unknown>,
    failure: string,
  ): Promise<void> {
    setActionError(undefined);
    if (name) setPendingAction(name);
    try {
      const outcome = await change();
      if (
        outcome &&
        typeof outcome === "object" &&
        "status" in outcome &&
        outcome.status === "failed"
      )
        setActionError((outcome as { reason?: string }).reason ?? failure);
    } catch (error) {
      setActionError(
        error instanceof Error && error.message ? error.message : failure,
      );
    } finally {
      if (name) setPendingAction(undefined);
    }
  }

  async function openComponent(component: PluginComponentState) {
    if (!selected) return;
    if (component.editing === "authored") {
      // Opening a connector is the person asking whether it works, and what
      // it answers says whether its service has its own sign-in.
      if (component.kind === "connection" && component.enabled)
        void onCheckConnection(component.id).catch(() => undefined);
      await openAuthored(component.kind, component.id);
      return;
    }
    if (component.kind === "connection") {
      setOpened({ mode: "connector", component });
      return;
    }
    try {
      const content = await onLoadComponentContent(component.id);
      setOpened(
        content
          ? { mode: "override", content }
          : { mode: "error", message: "This component no longer exists." },
      );
    } catch {
      setOpened({
        mode: "error",
        message: "This component's content could not be loaded.",
      });
    }
  }

  async function openAuthored(
    kind: PluginComponentState["kind"],
    fullId: string | undefined,
  ) {
    if (!selected) return;
    const pluginId = selected.id;
    try {
      const contents = await onLoadEditableContents(pluginId);
      if (!contents) throw new Error("missing");
      setOpened({
        mode: "authored",
        pluginId,
        kind,
        localId: fullId === undefined ? undefined : localIdOf(pluginId, fullId),
        contents,
      });
    } catch {
      setOpened({
        mode: "error",
        message: "Could not load this plugin's contents.",
      });
    }
  }

  function renderOpened() {
    if (!opened) return null;
    const close = () => setOpened(undefined);
    if (opened.mode === "error")
      return (
        <Dialog title="Could not open this component" onClose={close}>
          <p role="alert">{opened.message}</p>
        </Dialog>
      );
    if (opened.mode === "override")
      return (
        <OverrideEditor
          content={opened.content}
          onSave={(draft) => onOverrideComponent(opened.content.id, draft)}
          onReset={() => onResetComponent(opened.content.id)}
          onClose={close}
        />
      );
    if (opened.mode === "connector") {
      const id = opened.component.id;
      const current =
        selected?.components.find((component) => component.id === id) ??
        opened.component;
      return (
        <ConnectorSettings
          component={current}
          server={mcpServers.find((server) => server.id === id)}
          onTest={onTestConnection}
          onCheck={onCheckConnection}
          onSaveToken={(token) => onSaveConnectionToken(id, token)}
          onClearToken={() => onClearConnectionToken(id)}
          onSignIn={() => onSignInToConnection(id)}
          onCancelSignIn={() => onCancelConnectionSignIn(id)}
          onSetToolEnabled={(tool, enabled) =>
            onSetConnectionToolEnabled(id, tool, enabled)
          }
          onOpenExternalUrl={onOpenExternalUrl}
          onClose={close}
        />
      );
    }
    if (opened.mode === "install")
      return (
        <ToolchainInstallDialog
          component={opened.component}
          onClose={close}
          onInstall={() => {
            const id = opened.component.id;
            close();
            void attempt(
              undefined,
              () => onInstallToolchain(id),
              "The installation did not finish.",
            );
          }}
        />
      );
    const draft = draftFromContents(
      opened.contents,
      opened.localId,
      opened.kind,
    );
    if (!draft)
      return (
        <Dialog title="Could not open this component" onClose={close}>
          <p role="alert">This component no longer exists.</p>
        </Dialog>
      );
    const fullId = (localId: string) => `${opened.pluginId}/${localId}`;
    const server =
      opened.localId !== undefined
        ? mcpServers.find((item) => item.id === fullId(opened.localId!))
        : undefined;
    return (
      <ComponentEditor
        draft={draft}
        onClose={close}
        onSave={async (saved) => {
          await onSavePluginContents(
            opened.pluginId,
            nextContents(opened.contents, opened.localId, saved),
          );
          // Reached at once, so the list says whether it connected or what
          // it still needs, without a test before saving.
          if (saved.kind === "connection")
            void onCheckConnection(fullId(saved.id)).catch(() => undefined);
        }}
        {...(opened.localId !== undefined
          ? {
              onRemove: () =>
                onSavePluginContents(
                  opened.pluginId,
                  nextContents(opened.contents, opened.localId, undefined),
                ),
            }
          : {})}
        {...(draft.kind === "connection"
          ? {
              onTest: onTestConnection,
              onSaveToken: (localId: string, token: string) =>
                onSaveConnectionToken(fullId(localId), token),
              onSetToolEnabled: (toolName: string, enabled: boolean) =>
                onSetConnectionToolEnabled(fullId(draft.id), toolName, enabled),
              onSignIn: (localId: string) =>
                onSignInToConnection(fullId(localId)),
              onCancelSignIn: (localId: string) =>
                onCancelConnectionSignIn(fullId(localId)),
              onSignOut: (localId: string) =>
                onClearConnectionToken(fullId(localId)),
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

  return (
    <SurfacePanel
      label="Plugins"
      className={styles["capability-library"]}
      headerClassName={styles["library-header"]}
      scroll="contained"
      eyebrow={<p className="instrument-label">Workspace / Plugins</p>}
      title="Plugins"
      closeLabel="Close plugins"
      onClose={onClose}
      controls={
        <>
          <button
            className={`button button--quiet ${styles["library-action"]}`}
            type="button"
            disabled={pendingAction === "install"}
            onClick={() =>
              void attempt(
                "install",
                onInstallPlugin,
                "The plugin could not be installed.",
              )
            }
          >
            {pendingAction === "install"
              ? "Installing…"
              : "Import from a folder…"}
          </button>
          <button
            className={`button ${styles["library-action"]} ${styles["library-new"]}`}
            type="button"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" />
            New plugin
          </button>
        </>
      }
    >
      {actionError && (
        <p role="alert" className={styles["capability-error"]}>
          {actionError}
        </p>
      )}
      {shell && !shell.available && (
        <div role="status" className={styles["shell-notice"]}>
          <span>Shell commands are unavailable. {shell.reason}</span>
          <span className={styles["shell-notice__actions"]}>
            <button
              type="button"
              className="button button--small"
              onClick={() => void onOpenExternalUrl(shell.installUrl)}
            >
              Get Git for Windows
            </button>
            <button
              type="button"
              className="button button--small button--quiet"
              disabled={checkingShell}
              onClick={() => void recheckShell()}
            >
              {checkingShell ? "Checking…" : "Check again"}
            </button>
          </span>
        </div>
      )}
      <div className={styles["plugin-layout"]}>
        <aside className={styles["plugin-directory"]}>
          <label className={styles["plugin-search"]}>
            <Icon name="search" />
            <input
              type="search"
              aria-label="Find plugins"
              placeholder="Find a plugin"
              value={query}
              disabled={loading}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div className={styles["plugin-directory__count"]}>
            <span>Installed</span>
            {!loading && <span>{visible.length}</span>}
          </div>
          <nav aria-label="Installed plugins">
            {visible.map((plugin) => {
              const badge = pluginBadge(plugin);
              const isSelected = selected?.id === plugin.id;
              return (
                <button
                  type="button"
                  key={plugin.id}
                  aria-pressed={isSelected}
                  className={`${styles["plugin-row"]}${isSelected ? ` ${styles["plugin-row--selected"]}` : ""}${plugin.enabled ? "" : ` ${styles["plugin-row--off"]}`}`}
                  onClick={() => {
                    setSelectedId(plugin.id);
                    setActionError(undefined);
                  }}
                >
                  <span className={styles["plugin-row__copy"]}>
                    <strong>{plugin.name}</strong>
                    <span>{plugin.category}</span>
                  </span>
                  {badge && plugin.status === "partial" ? (
                    <span
                      className={`${styles["plugin-status"]} ${styles["plugin-status--partial"]} ${styles["plugin-status--icon"]}`}
                      role="img"
                      aria-label={badge}
                      data-tip={badge}
                    >
                      <Icon name="settings" />
                    </span>
                  ) : (
                    badge && (
                      <span
                        className={`${styles["plugin-status"]} ${styles[`plugin-status--${plugin.status}`]}`}
                      >
                        {badge}
                      </span>
                    )
                  )}
                </button>
              );
            })}
          </nav>
          {loading && (
            <p className={styles["plugin-empty"]}>Loading installed plugins…</p>
          )}
          {!loading && !visible.length && (
            <p className={styles["plugin-empty"]}>
              {query.trim()
                ? `No installed plugin matches “${query.trim()}”.`
                : "No plugins installed yet."}
            </p>
          )}
        </aside>

        {selected ? (
          <PluginDetail
            key={selected.id}
            plugin={selected}
            actions={{
              onToggle: (id, enabled) =>
                attempt(
                  undefined,
                  () => onToggleComponent(id, enabled),
                  "The change could not be saved.",
                ),
              onOpen: (component) => void openComponent(component),
              onInstall: (component) =>
                setOpened({ mode: "install", component }),
              // An application connector's prerequisite is outside the app,
              // so all of them are looked at again; a configured one is
              // reached on its own.
              onRecheck: (component) =>
                attempt(
                  undefined,
                  component.appConnector
                    ? onRefreshConnections
                    : async () => {
                        await onCheckConnection(component.id);
                      },
                  "Connections could not be checked.",
                ),
            }}
            management={{
              pending: pendingAction,
              onToggle: (enabled) =>
                attempt(
                  undefined,
                  () => onTogglePlugin(selected.id, enabled),
                  "The change could not be saved.",
                ),
              onUpdate: () =>
                attempt(
                  "update",
                  () => onUpdatePlugin(selected.id),
                  "The plugin could not be updated.",
                ),
              onRollback: () =>
                attempt(
                  "rollback",
                  () => onRollbackPlugin(selected.id),
                  "The previous version could not be restored.",
                ),
              onRemove: () =>
                attempt(
                  "remove",
                  () => onRemovePlugin(selected.id),
                  "The plugin could not be removed.",
                ),
              onNewComponent: (kind) => void openAuthored(kind, undefined),
            }}
          />
        ) : loading ? (
          <div className={styles["plugin-details--empty"]} aria-live="polite">
            <Icon name="clock" />
            <h2>Loading plugins</h2>
            <p>Checking what's already installed.</p>
          </div>
        ) : (
          <div className={styles["plugin-details--empty"]}>
            <Icon name="plug" />
            <h2>No plugins to show</h2>
            <p>Clear the search, or create a new plugin to get started.</p>
          </div>
        )}
      </div>

      {creating && (
        <NewPluginDialog
          onClose={() => setCreating(false)}
          onCreate={async (name, description) => {
            await onCreatePlugin(name, description);
            setCreating(false);
          }}
        />
      )}

      {renderOpened()}
    </SurfacePanel>
  );
}
