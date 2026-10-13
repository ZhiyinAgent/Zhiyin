import { useState } from "react";
import type {
  AuthoredPluginContents,
  ComponentContent,
  McpServerState,
  PluginComponentState,
  PluginSourceOutcome,
  PluginState,
  ShellAvailability,
} from "@zhiyin/contract";
import { Icon, SurfacePanel } from "../shared/index.js";
import { localIdOf } from "./componentDrafts.js";
import { NewPluginDialog } from "./NewPluginDialog.js";
import {
  OpenedComponent,
  type Opened,
  type OpenedActions,
} from "./OpenedComponent.js";
import { PluginDetail } from "./PluginDetail.js";
import { PluginDirectory } from "./PluginDirectory.js";
import { ShellNotice } from "./ShellNotice.js";
import styles from "./capabilities.module.css";

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
}: OpenedActions & {
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
  onToggleComponent: (id: string, enabled: boolean) => Promise<void>;
  onLoadComponentContent: (id: string) => Promise<ComponentContent | undefined>;
  onInstallToolchain: (id: string) => Promise<void>;
  /** Re-checks every connection now, trying failed ones again. */
  onRefreshConnections: () => Promise<void>;
  /** The current reading, fetched once on open — never cached beyond that. */
  onCheckShell: () => Promise<ShellAvailability>;
  /** Re-detects the shell on request, so an install just now is picked up. */
  onRecheckShell: () => Promise<ShellAvailability>;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [pendingAction, setPendingAction] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<Opened | undefined>();

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
      <ShellNotice
        onCheck={onCheckShell}
        onRecheck={onRecheckShell}
        onOpenExternalUrl={onOpenExternalUrl}
      />
      <div className={styles["plugin-layout"]}>
        <PluginDirectory
          plugins={visible}
          selectedId={selected?.id}
          query={query}
          loading={loading}
          onQuery={setQuery}
          onSelect={(id) => {
            setSelectedId(id);
            setActionError(undefined);
          }}
        />

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

      {opened && (
        <OpenedComponent
          opened={opened}
          plugin={selected}
          mcpServers={mcpServers}
          actions={{
            onSavePluginContents,
            onOverrideComponent,
            onResetComponent,
            onTestConnection,
            onSetConnectionToolEnabled,
            onSaveConnectionToken,
            onClearConnectionToken,
            onSignInToConnection,
            onCancelConnectionSignIn,
            onCheckConnection,
            onOpenExternalUrl,
          }}
          onInstall={(id) => {
            setOpened(undefined);
            void attempt(
              undefined,
              () => onInstallToolchain(id),
              "The installation did not finish.",
            );
          }}
          onClose={() => setOpened(undefined)}
        />
      )}
    </SurfacePanel>
  );
}
