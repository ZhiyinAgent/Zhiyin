import { useState } from "react";
import type { PluginComponentState, PluginState } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./capabilities.module.css";

const groupTitles = {
  skill: "Skills",
  specialist: "Specialists",
  connection: "Connectors",
} as const;

const groupEmpty = {
  skill: "No skills yet.",
  specialist: "No specialists yet.",
  connection: "No connectors yet.",
} as const;

/** Where a plugin came from, in the words a person would use. */
export function originLabel(plugin: PluginState): string {
  if (plugin.source === "built-in") return "Built-in";
  if (plugin.source === "marketplace") return "From the marketplace";
  if (plugin.source === "project") return "From this project";
  return plugin.editing === "authored" ? "Made in Zhiyin" : "Imported";
}

/**
 * A connector's readiness, which speaks only when something is wrong: a
 * working connector, and one still waiting to be set up, are both already
 * told by the switch beside them.
 */
function connectionStatus(component: PluginComponentState): string {
  if (component.toolchain?.status === "installing") return "Installing…";
  switch (component.status) {
    case "ready":
      return "";
    case "off":
      return "Off";
    case "failed":
      return component.toolchain?.status === "failed"
        ? "Setup failed"
        : "Couldn't connect";
    case "unavailable":
      return "Unavailable";
    case "setup-required":
      return "";
  }
}

function statusClass(component: PluginComponentState): string {
  const toolchainFailed = component.toolchain?.status === "failed";
  return (
    styles[
      `plugin-component__status--${toolchainFailed ? "failed" : component.status}`
    ] ?? ""
  );
}

export type ComponentActions = {
  readonly onToggle: (id: string, enabled: boolean) => void | Promise<void>;
  readonly onOpen: (component: PluginComponentState) => void;
  readonly onInstall: (component: PluginComponentState) => void;
  readonly onRecheck: () => void | Promise<void>;
};

function ComponentRow({
  component,
  actions,
}: {
  component: PluginComponentState;
  actions: ComponentActions;
}) {
  const isConnection = component.kind === "connection";
  const toolchain = component.toolchain;
  const needsInstall =
    toolchain?.status === "missing" || toolchain?.status === "failed";
  const installing = toolchain?.status === "installing";
  /** Nothing to switch on until it is set up, wherever the setup happens. */
  const awaitingSetup = component.status === "setup-required";
  const canOpen =
    component.editing !== "none" ||
    (isConnection &&
      !component.appConnector &&
      component.status !== "unavailable");
  const canRecheck =
    isConnection &&
    !needsInstall &&
    !installing &&
    component.enabled &&
    (component.status === "failed" ||
      (component.status === "setup-required" && component.appConnector));
  return (
    <li
      className={`${styles["plugin-component"]}${component.enabled && !awaitingSetup ? "" : ` ${styles["plugin-component--disabled"]}`}`}
    >
      <span className={styles["plugin-component__copy"]}>
        <strong>{component.name}</strong>
        <span>{component.description}</span>
        {component.overridden && (
          <small className={styles["plugin-component__edited"]}>
            {component.shippedChanged
              ? "Your edit · the plugin now ships a different version"
              : "Your edit"}
          </small>
        )}
        {component.detail && <small>{component.detail}</small>}
      </span>
      <span
        className={`${styles["plugin-component__status"]} ${isConnection ? statusClass(component) : ""}`}
      >
        {isConnection ? connectionStatus(component) : ""}
      </span>
      <span className={styles["plugin-component__control"]}>
        {component.status !== "unavailable" && (
          <button
            type="button"
            role="switch"
            aria-checked={awaitingSetup ? false : component.enabled}
            aria-label={`${component.enabled && !awaitingSetup ? "Turn off" : "Turn on"} ${component.name}`}
            disabled={awaitingSetup}
            className={styles["plugin-switch"]}
            onClick={() =>
              void actions.onToggle(component.id, !component.enabled)
            }
          >
            <span aria-hidden="true" />
          </button>
        )}
      </span>
      <span className={styles["plugin-component__actions"]}>
        {needsInstall && (
          <button
            type="button"
            className={styles["plugin-component__edit"]}
            onClick={() => actions.onInstall(component)}
          >
            {toolchain?.status === "failed" ? "Try again" : "Set up"}
          </button>
        )}
        {installing && (
          <button
            type="button"
            className={styles["plugin-component__edit"]}
            disabled
          >
            Installing…
          </button>
        )}
        {canRecheck && (
          <button
            type="button"
            className={styles["plugin-component__edit"]}
            onClick={() => void actions.onRecheck()}
          >
            Check again
          </button>
        )}
        {canOpen && (
          <button
            type="button"
            className={styles["plugin-component__edit"]}
            aria-label={`${openLabel(component)} ${component.name}`}
            onClick={() => actions.onOpen(component)}
          >
            {openLabel(component)}
          </button>
        )}
      </span>
    </li>
  );
}

function openLabel(component: PluginComponentState): string {
  if (component.kind !== "connection" || component.editing === "authored")
    return "Edit";
  return component.status === "setup-required" ? "Set up" : "Settings";
}

function ComponentGroup({
  kind,
  components,
  authored,
  actions,
  onNew,
}: {
  kind: PluginComponentState["kind"];
  components: readonly PluginComponentState[];
  authored: boolean;
  actions: ComponentActions;
  onNew: () => void;
}) {
  if (!components.length && !authored) return null;
  return (
    <section className={styles["plugin-group"]}>
      <header>
        <h3>{groupTitles[kind]}</h3>
        <span className={styles["plugin-group__count"]}>
          {components.length}
        </span>
        {authored && (
          <button
            type="button"
            className={styles["plugin-group__new"]}
            onClick={onNew}
          >
            <Icon name="plus" />
            New {kind === "connection" ? "connector" : kind}
          </button>
        )}
      </header>
      {components.length === 0 ? (
        <p className={styles["plugin-group__empty"]}>{groupEmpty[kind]}</p>
      ) : (
        <ul>
          {components.map((component) => (
            <ComponentRow
              key={component.id}
              component={component}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export type PluginManagement = {
  readonly pending: string | undefined;
  readonly onToggle: (enabled: boolean) => void | Promise<void>;
  readonly onUpdate: () => void | Promise<void>;
  readonly onRollback: () => void | Promise<void>;
  readonly onRemove: () => Promise<void>;
  readonly onNewComponent: (kind: PluginComponentState["kind"]) => void;
};

export function PluginDetail({
  plugin,
  actions,
  management,
}: {
  plugin: PluginState;
  actions: ComponentActions;
  management: PluginManagement;
}) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const authored = plugin.editing === "authored";
  const imported = plugin.source !== "built-in" && !authored;
  const removable = plugin.source !== "built-in";
  const busy = management.pending !== undefined;
  const grouped = {
    skill: plugin.components.filter((c) => c.kind === "skill"),
    specialist: plugin.components.filter((c) => c.kind === "specialist"),
    connection: plugin.components.filter((c) => c.kind === "connection"),
  };

  return (
    <article
      className={styles["plugin-details"]}
      role="region"
      aria-label={`${plugin.name} details`}
    >
      <header className={styles["plugin-details__header"]}>
        <div className={styles["plugin-details__title"]}>
          <h2>{plugin.name}</h2>
          <label className={styles["plugin-details__activation"]}>
            <button
              type="button"
              role="switch"
              aria-checked={plugin.enabled}
              aria-label={`${plugin.enabled ? "Turn off" : "Turn on"} ${plugin.name} plugin`}
              className={styles["plugin-switch"]}
              onClick={() => void management.onToggle(!plugin.enabled)}
            >
              <span aria-hidden="true" />
            </button>
            <span>{plugin.enabled ? "On" : "Off"}</span>
          </label>
        </div>
        <p className={styles["plugin-details__meta"]}>
          {originLabel(plugin)} · {plugin.publisher} · Version {plugin.version}
        </p>
        <p className={styles["plugin-details__description"]}>
          {plugin.description}
        </p>
        {(plugin.accessSummary ||
          plugin.dataDestination ||
          plugin.defaultPrompts.length > 0) && (
          <dl className={styles["plugin-facts"]}>
            {plugin.accessSummary && (
              <div>
                <dt>What it can use</dt>
                <dd>{plugin.accessSummary}</dd>
              </div>
            )}
            {plugin.dataDestination && (
              <div>
                <dt>Where data goes</dt>
                <dd>{plugin.dataDestination}</dd>
              </div>
            )}
            {plugin.defaultPrompts.length > 0 && (
              <div>
                <dt>Try asking</dt>
                <dd>{plugin.defaultPrompts.join(" · ")}</dd>
              </div>
            )}
          </dl>
        )}
      </header>

      {!plugin.enabled && (
        <p className={styles["plugin-off-notice"]}>
          This plugin is off. Zhiyin keeps your choices below but uses none of
          them until you turn it on.
        </p>
      )}

      {removable && !confirmingRemoval && (
        <div
          className={styles["plugin-management"]}
          role="group"
          aria-label={`Manage ${plugin.name}`}
        >
          {imported && (
            <button
              className="button button--small"
              type="button"
              disabled={busy}
              onClick={() => void management.onUpdate()}
            >
              {management.pending === "update"
                ? "Updating…"
                : "Update from a folder…"}
            </button>
          )}
          {imported && plugin.rollbackAvailable && (
            <button
              className="button button--small"
              type="button"
              disabled={busy}
              onClick={() => void management.onRollback()}
            >
              {management.pending === "rollback"
                ? "Rolling back…"
                : "Roll back"}
            </button>
          )}
          <button
            className="button button--small"
            type="button"
            disabled={busy}
            onClick={() => setConfirmingRemoval(true)}
          >
            Remove
          </button>
        </div>
      )}

      {removable && confirmingRemoval && (
        <div className={styles["capability-confirm"]} role="alert">
          <div>
            <strong>Remove {plugin.name}?</strong>
            <p>
              This removes it, everything it added, and any access tokens its
              connectors use. This cannot be undone here.
            </p>
          </div>
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => setConfirmingRemoval(false)}
          >
            Keep it
          </button>
          <button
            className="button button--accent"
            type="button"
            disabled={busy}
            onClick={() =>
              void management.onRemove().then(() => setConfirmingRemoval(false))
            }
          >
            {management.pending === "remove"
              ? "Removing…"
              : "Remove permanently"}
          </button>
        </div>
      )}

      <div
        className={`${styles["plugin-groups"]}${plugin.enabled ? "" : ` ${styles["plugin-groups--off"]}`}`}
      >
        {(["skill", "specialist", "connection"] as const).map((kind) => (
          <ComponentGroup
            key={kind}
            kind={kind}
            components={grouped[kind]}
            authored={authored}
            actions={actions}
            onNew={() => management.onNewComponent(kind)}
          />
        ))}
      </div>
    </article>
  );
}
