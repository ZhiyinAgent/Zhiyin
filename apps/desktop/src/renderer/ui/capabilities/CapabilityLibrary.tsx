import { useEffect, useState } from "react";
import type {
  AuthoredPluginContents,
  ComponentContent,
  ComponentContentDraft,
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  PluginComponentState,
  PluginSourceOutcome,
  PluginState,
  ShellAvailability,
} from "@zhiyin/contract";
import { Dialog, Icon, SurfacePanel } from "../shared/index.js";
import { ComponentEditor, type ComponentDraft } from "./ComponentEditor.js";
import { ConnectorSettings } from "./ConnectorSettings.js";
import { OverrideEditor } from "./OverrideEditor.js";
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

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${Math.round(bytes / 1_000_000)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** The part of a component id after its plugin's name. */
function localIdOf(pluginId: string, fullId: string): string {
  const prefix = `${pluginId}/`;
  return fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
}

function emptyDraft(kind: PluginComponentState["kind"]): ComponentDraft {
  if (kind === "skill")
    return { kind, id: "", description: "", instructions: "" };
  if (kind === "specialist")
    return { kind, id: "", name: "", description: "", instructions: "" };
  return { kind, id: "", name: "", url: "", access: "", dataDestination: "" };
}

function draftFromContents(
  contents: AuthoredPluginContents,
  localId: string | undefined,
  kind: PluginComponentState["kind"],
): ComponentDraft | undefined {
  if (localId === undefined) return emptyDraft(kind);
  const skill = contents.skills.find((item) => item.id === localId);
  if (skill) return { kind: "skill", ...skill };
  const specialist = contents.specialists.find((item) => item.id === localId);
  if (specialist) return { kind: "specialist", ...specialist };
  const server = contents.mcpServers.find((item) => item.id === localId);
  if (server)
    return {
      kind: "connection",
      id: server.id,
      name: server.name,
      url: server.url,
      access: server.access ?? "",
      dataDestination: server.dataDestination ?? "",
    };
  return undefined;
}

/** A plugin's whole content with one component replaced, added, or removed. */
function nextContents(
  contents: AuthoredPluginContents,
  removedLocalId: string | undefined,
  saved: ComponentDraft | undefined,
): AuthoredPluginContents {
  const without = {
    ...contents,
    skills: contents.skills.filter((item) => item.id !== removedLocalId),
    specialists: contents.specialists.filter(
      (item) => item.id !== removedLocalId,
    ),
    mcpServers: contents.mcpServers.filter(
      (item) => item.id !== removedLocalId,
    ),
  };
  if (saved?.kind === "skill") {
    const { id, description, instructions } = saved;
    return {
      ...without,
      skills: [...without.skills, { id, description, instructions }],
    };
  }
  if (saved?.kind === "specialist") {
    const { id, name, description, instructions } = saved;
    return {
      ...without,
      specialists: [
        ...without.specialists,
        { id, name, description, instructions },
      ],
    };
  }
  if (saved?.kind === "connection")
    return {
      ...without,
      mcpServers: [
        ...without.mcpServers,
        {
          id: saved.id,
          name: saved.name,
          description: saved.name,
          url: saved.url,
          ...(saved.access ? { access: saved.access } : {}),
          ...(saved.dataDestination
            ? { dataDestination: saved.dataDestination }
            : {}),
        },
      ],
    };
  return without;
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
  onRefreshConnections,
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
  /** Re-checks every connection now, trying failed ones again. */
  onRefreshConnections: () => Promise<void>;
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
          onSaveToken={(token) => onSaveConnectionToken(id, token)}
          onClearToken={() => onClearConnectionToken(id)}
          onSetToolEnabled={(tool, enabled) =>
            onSetConnectionToolEnabled(id, tool, enabled)
          }
          onClose={close}
        />
      );
    }
    if (opened.mode === "install") {
      const toolchain = opened.component.toolchain;
      const downloads =
        toolchain?.status === "missing" ? toolchain.downloads : [];
      const total = downloads.reduce((sum, item) => sum + item.bytes, 0);
      return (
        <Dialog
          title={`Set up ${opened.component.name}`}
          onClose={close}
          footer={
            <>
              <button className="button" type="button" onClick={close}>
                Not now
              </button>
              <button
                className="button button--accent"
                type="button"
                onClick={() => {
                  const id = opened.component.id;
                  close();
                  void attempt(
                    undefined,
                    () => onInstallToolchain(id),
                    "The installation did not finish.",
                  );
                }}
              >
                Install
              </button>
            </>
          }
        >
          <div className={styles["install-dialog"]}>
            <p className={styles["install-dialog__lead"]}>
              {opened.component.description}
            </p>
            {downloads.length > 0 && (
              <div className={styles["install-manifest"]}>
                <div className={styles["install-manifest__head"]}>
                  <span>What gets downloaded</span>
                  <span>{formatBytes(total)}</span>
                </div>
                <ul>
                  {downloads.map((item) => (
                    <li key={`${item.name} ${item.version}`}>
                      <span className={styles["install-manifest__name"]}>
                        <strong>
                          {item.name} {item.version}
                        </strong>
                        <small>{item.source}</small>
                      </span>
                      <span className={styles["install-manifest__size"]}>
                        {formatBytes(item.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className={styles["install-note"]}>
              <Icon name="lock" />
              Every download is checked against its published fingerprint before
              it runs.
            </p>
            {opened.component.dataDestination && (
              <p className={styles["install-note"]}>
                <Icon name="globe" />
                {opened.component.dataDestination}
              </p>
            )}
          </div>
        </Dialog>
      );
    }
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
        onSave={(saved) =>
          onSavePluginContents(
            opened.pluginId,
            nextContents(opened.contents, opened.localId, saved),
          )
        }
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
              ...(server
                ? {
                    connectionState: {
                      status: server.status,
                      tools: server.tools ?? [],
                      tokenSaved: server.credential.status === "saved",
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
                    >
                      <Icon name="alert" />
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
              onRecheck: () =>
                attempt(
                  undefined,
                  onRefreshConnections,
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

function NewPluginDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function create() {
    setAttempted(true);
    if (!name.trim() || !description.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      await onCreate(name.trim(), description.trim());
    } catch {
      setError("Could not create this plugin. Try a different name.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title="New plugin"
      onClose={onClose}
      footer={
        <button
          className="button button--accent"
          type="submit"
          form="new-plugin-form"
          disabled={pending}
        >
          {pending ? "Creating…" : "Create plugin"}
        </button>
      }
    >
      <form
        id="new-plugin-form"
        className={styles["component-editor__form"]}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label>
          <span>Name</span>
          <input
            aria-label="Name"
            aria-invalid={(attempted && !name.trim()) || undefined}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {attempted && !name.trim() && (
            <small role="alert">Enter a name.</small>
          )}
        </label>
        <label>
          <span>Description</span>
          <textarea
            aria-label="Description"
            aria-invalid={(attempted && !description.trim()) || undefined}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          {attempted && !description.trim() && (
            <small role="alert">Add a description.</small>
          )}
        </label>
        {error && (
          <p className={styles["component-editor__error"]} role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
