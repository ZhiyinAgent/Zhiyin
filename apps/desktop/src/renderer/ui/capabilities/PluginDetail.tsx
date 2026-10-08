import { useState } from "react";
import type { PluginComponentState, PluginState } from "@zhiyin/contract";
import { Icon, InfoTip } from "../shared/index.js";
import { inWords } from "./names.js";
import styles from "./capabilities.module.css";

const groupTitles = {
  skill: "Skills",
  specialist: "Specialists",
  connection: "Connectors",
} as const;

/**
 * What each kind is, for someone meeting the word for the first time: two
 * sentences on what it is and whether it needs setting up, and what it can
 * reach under Details.
 */
const groupHelp = {
  skill: {
    topic: "skills",
    summary:
      "A skill is written guidance Zhiyin follows for one kind of work, such as checking citations. There is nothing to set up: Zhiyin reads one when a conversation needs it.",
    details:
      "A skill reaches nothing by itself; it only changes how Zhiyin works. Switch one off to stop Zhiyin using it.",
  },
  specialist: {
    topic: "specialists",
    summary:
      "A specialist is a helper Zhiyin can hand part of a task to, such as a fact-checker. There is nothing to set up: Zhiyin decides when one would help.",
    details:
      "A specialist works under Zhiyin's own rules: what it would change asks for your approval as Zhiyin's actions do, and some can only read. Switch one off to stop Zhiyin using it.",
  },
  connection: {
    topic: "connectors",
    summary:
      "A connector lets Zhiyin use another service or program, such as GitHub, a web search or a browser. Each one is optional: set one up only when you want Zhiyin to use it.",
    details:
      "A connector to an online service needs a key you make on that service, which Zhiyin keeps in Windows Credential Manager. Zhiyin asks before each action it takes through such a connector, unless you allow that action for the conversation; switching it on allows nothing by itself.",
  },
} as const;

const groupEmpty = {
  skill: "No skills yet.",
  specialist: "No specialists yet.",
  connection: "No connectors yet.",
} as const;

/** Where a plugin came from, in the words a person would use. */
function originLabel(plugin: PluginState): string {
  if (plugin.source === "built-in") return "Built-in";
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
    case "unchecked":
      return "Not checked yet";
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
  readonly onRecheck: (component: PluginComponentState) => void | Promise<void>;
};

/**
 * A switch shows its state by colour alone, so its name says it in words,
 * and says when its plugin being off overrides it.
 */
function switchName(name: string, on: boolean, pluginOn: boolean): string {
  if (!on) return `${name}: off`;
  return pluginOn ? `${name}: on` : `${name}: on, but its plugin is off`;
}

function ComponentRow({
  component,
  actions,
  pluginOn,
}: {
  component: PluginComponentState;
  actions: ComponentActions;
  pluginOn: boolean;
}) {
  const shownName = inWords(component.name);
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
      component.status === "unchecked" ||
      (component.status === "setup-required" && component.appConnector));
  return (
    <li
      className={`${styles["plugin-component"]}${component.enabled && !awaitingSetup ? "" : ` ${styles["plugin-component--disabled"]}`}`}
    >
      <span className={styles["plugin-component__copy"]}>
        <strong>{shownName}</strong>
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
            aria-label={switchName(
              shownName,
              component.enabled && !awaitingSetup,
              pluginOn,
            )}
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
            onClick={() => void actions.onRecheck(component)}
          >
            {component.status === "unchecked" ? "Check" : "Check again"}
          </button>
        )}
        {canOpen && (
          <button
            type="button"
            className={styles["plugin-component__edit"]}
            aria-label={`${openLabel(component)} ${shownName}`}
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
  pluginOn,
  onNew,
}: {
  kind: PluginComponentState["kind"];
  components: readonly PluginComponentState[];
  authored: boolean;
  actions: ComponentActions;
  pluginOn: boolean;
  onNew: () => void;
}) {
  if (!components.length && !authored) return null;
  return (
    <section className={styles["plugin-group"]}>
      <header>
        <h3>{groupTitles[kind]}</h3>
        <InfoTip
          topic={groupHelp[kind].topic}
          details={groupHelp[kind].details}
        >
          {groupHelp[kind].summary}
        </InfoTip>
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
              pluginOn={pluginOn}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** "its 2 skills, 1 specialist and 2 connectors", leaving out what it lacks. */
function contentsOf(grouped: Record<PluginComponentState["kind"], unknown[]>) {
  const words = {
    skill: ["skill", "skills"],
    specialist: ["specialist", "specialists"],
    connection: ["connector", "connectors"],
  } as const;
  const parts = (["skill", "specialist", "connection"] as const)
    .filter((kind) => grouped[kind].length > 0)
    .map((kind) => {
      const count = grouped[kind].length;
      return `${count} ${words[kind][count === 1 ? 0 : 1]}`;
    });
  if (!parts.length) return undefined;
  return parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
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

  const contents = contentsOf(grouped);
  const removal = [
    contents &&
      `Removing it deletes its ${contents}${grouped.connection.length ? ", and the access tokens its connectors use" : ""}.`,
    "This cannot be undone.",
  ]
    .filter(Boolean)
    .join(" ");

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
              aria-label={`${plugin.name} plugin: ${plugin.enabled ? "on" : "off"}`}
              className={styles["plugin-switch"]}
              onClick={() => void management.onToggle(!plugin.enabled)}
            >
              <span aria-hidden="true" />
            </button>
            <span>{plugin.enabled ? "On" : "Off"}</span>
          </label>
        </div>
        <div className={styles["plugin-details__meta-row"]}>
          <p className={styles["plugin-details__meta"]}>
            {originLabel(plugin)} · {plugin.publisher} · Version{" "}
            {plugin.version}
          </p>
          {removable && !confirmingRemoval && (
            <div
              className={styles["plugin-management"]}
              role="group"
              aria-label={`Manage ${plugin.name}`}
            >
              {imported && (
                <button
                  className="button button--small button--quiet"
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
                  className="button button--small button--quiet"
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
        </div>
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

      {removable && confirmingRemoval && (
        <div className={styles["capability-confirm"]} role="alert">
          <div>
            <strong>Remove {plugin.name}?</strong>
            <p>{removal}</p>
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
            pluginOn={plugin.enabled}
            onNew={() => management.onNewComponent(kind)}
          />
        ))}
      </div>
    </article>
  );
}
