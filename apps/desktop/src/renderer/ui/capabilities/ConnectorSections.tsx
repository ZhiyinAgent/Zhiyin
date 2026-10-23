/**
 * The sections of a declared connector's settings: what it is, whether it
 * answers, how its key is made and kept, and which of its tools may be used.
 * Each shows what the dialog holds and hands back what the person did.
 */

import { useId } from "react";
import type {
  ConnectorSetup,
  McpConnectionTestOutcome,
  McpServerState,
  McpToolSummary,
  PluginComponentState,
} from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import { inWords } from "./names.js";
import styles from "./capabilities.module.css";

/** Where reaching a connector now stands, from asking to its answer. */
export type Check =
  | { readonly status: "checking" }
  | {
      readonly status: "answered";
      readonly state: McpServerState;
      /** When the answer arrived, so the label is computed outside render. */
      readonly at: number;
    }
  | { readonly status: "unreachable" };

/**
 * Why a check failed and what to do about it, without calling an anonymous
 * refusal a bad key, or asking for the key again when the service is down.
 */
function failureOf(
  state: McpServerState,
  name: string,
  keyName: string,
): readonly string[] {
  const saved = state.credential.status === "saved";
  if (state.status === "unauthorized" && state.signIn && !saved)
    return [`Sign in to ${name} to use this connector.`];
  if (state.status === "unauthorized")
    return saved
      ? [
          `${name} refused the saved ${keyName}. It may have expired, been deleted, or lack a permission; make a new one and paste it below.`,
        ]
      : [`This connector needs ${withArticle(keyName)} before it can be used.`];
  return [
    state.reason ?? "This connector did not answer.",
    `Try again later.${saved ? ` Your saved ${keyName} is kept.` : ""}`,
  ];
}

/** "an API key", "a personal access token". */
const withArticle = (noun: string) =>
  `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;

/** How long ago a connection answered: a past answer is not a live one. */
function checkedWhen(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "checked just now";
  if (minutes < 60) return `checked ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `checked ${hours} h ago`;
  return `checked ${new Date(at).toLocaleDateString()}`;
}

/** What the plugin says of the connector, and whether its key is saved. */
export function ConnectorFacts({
  component,
  server,
  usesKey,
}: {
  component: PluginComponentState;
  server: McpServerState | undefined;
  /** The connector is reached with a key, so the state of one is said. */
  usesKey: boolean;
}) {
  return (
    <dl className={styles["plugin-facts"]}>
      {component.access && (
        <div>
          <dt>What it needs</dt>
          <dd>{component.access}</dd>
        </div>
      )}
      {server?.url && (
        <div>
          <dt>Address</dt>
          <dd>{server.url}</dd>
        </div>
      )}
      {server && usesKey && (
        <div>
          <dt>Key</dt>
          <dd>
            {server.credential.status === "saved"
              ? "Saved"
              : server.credential.status === "unavailable"
                ? "Cannot be saved on this computer"
                : "Not saved"}
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Whether the connector answers: being asked, connected and since when, or
 * why not, with a way to ask again. One that cannot be asked says why it is
 * not in use instead.
 */
export function ConnectionCheck({
  check,
  component,
  keyName,
  refusalShown,
  awaitingKey,
  busy,
  onRetry,
}: {
  /** Absent for a connector that is off or that nothing has looked at. */
  check: Check | undefined;
  component: PluginComponentState;
  keyName: string;
  /** False where the sign-in card already says why the service refused. */
  refusalShown: boolean;
  /**
   * The connector names the key it needs and holds none yet: its steps ask
   * for the key, so neither its status nor a refusal is news.
   */
  awaitingKey: boolean;
  busy: boolean;
  onRetry: () => void;
}) {
  if (!check) {
    if (awaitingKey && component.enabled) return null;
    if (!component.enabled)
      return (
        <p className={styles["component-editor__changed"]} role="status">
          This connector is off. Turn it on in the plugin&apos;s list to use it.
          Turning it on allows nothing by itself: Zhiyin still asks before each
          action it takes, unless you allow that action for the conversation.
        </p>
      );
    return component.detail ? (
      <p className={styles["component-editor__changed"]} role="status">
        {component.detail}
      </p>
    ) : null;
  }
  if (
    check.status === "answered" &&
    check.state.status !== "connected" &&
    !refusalShown
  )
    return null;
  if (
    check.status === "answered" &&
    check.state.status === "unauthorized" &&
    awaitingKey &&
    check.state.credential.status === "none"
  )
    return null;
  return (
    <div className={styles["component-editor__test"]}>
      {check.status === "checking" && (
        <span className={styles["component-editor__test-status"]} role="status">
          Checking connection…
        </span>
      )}
      {check.status === "answered" && check.state.status === "connected" && (
        <span
          className={`${styles["component-editor__test-status"]} ${styles["component-editor__test-status--ok"]}`}
          role="status"
        >
          <Icon name="check" />
          Connected · {checkedWhen(check.state.checkedAt ?? check.at, check.at)}
        </span>
      )}
      {(check.status === "unreachable" ||
        (check.status === "answered" &&
          (check.state.status === "failed" ||
            check.state.status === "unauthorized"))) &&
        refusalShown && (
          <div className={styles["component-editor__problem"]}>
            <p role="alert">
              {check.status === "answered"
                ? failureOf(check.state, component.name, keyName).map(
                    (sentence, index) => (
                      <span key={sentence}>
                        {index > 0 && " "}
                        {sentence}
                      </span>
                    ),
                  )
                : "The connection could not be checked."}
            </p>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={onRetry}
            >
              Try again
            </button>
          </div>
        )}
    </div>
  );
}

/** How the connector's key is made on its service, step by step. */
export function KeySetupSteps({
  name,
  keyName,
  setup,
  onOpenExternalUrl,
}: {
  /** The connector's name, which is its service's. */
  name: string;
  keyName: string;
  setup: ConnectorSetup;
  /** Opens the service's own page where its key is made. */
  onOpenExternalUrl: (url: string) => Promise<void>;
}) {
  const setupHeading = useId();
  return (
    <section
      className={styles["connector-setup"]}
      aria-labelledby={setupHeading}
    >
      <h3 id={setupHeading}>How to set up</h3>
      <ol>
        <li>
          {`Create ${withArticle(keyName)} on ${name}'s site.${setup.advice ? ` ${setup.advice}` : ""}`}
          <button
            type="button"
            className={styles["connector-setup__open"]}
            onClick={() => void onOpenExternalUrl(setup.url)}
          >
            Open {name}
          </button>
        </li>
        <li>Paste it below and save it.</li>
        <li>Test the connection.</li>
      </ol>
      <p>
        {`${name} acts with whatever the ${keyName} allows. You can skip this connector: Zhiyin works without it.`}
      </p>
    </section>
  );
}

/**
 * Where the connector's key is pasted, or why none can be kept on this
 * computer. A key already saved is never shown.
 */
export function KeyField({
  label,
  keyName,
  saved,
  unavailable,
  token,
  onChange,
}: {
  /** What the key is called on the field. */
  label: string;
  keyName: string;
  saved: boolean;
  /** This computer has no secure storage to keep a key in. */
  unavailable: boolean;
  token: string;
  onChange: (token: string) => void;
}) {
  if (unavailable)
    return (
      <p className={styles["component-editor__error"]} role="alert">
        Secure storage for access tokens is unavailable on this computer, so a
        token cannot be saved.
      </p>
    );
  return (
    <label>
      <span>{saved ? `Replace ${keyName}` : label}</span>
      <input
        aria-label={label}
        type="password"
        autoComplete="off"
        placeholder={
          saved
            ? "Saved — paste a new one to replace it"
            : "Paste the token from the service"
        }
        value={token}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/**
 * What can be done with the key: test the connection with it, save it,
 * remove the one saved, and what the last test found.
 */
export function KeyActions({
  pending,
  testable,
  savable,
  saved,
  result,
  onTest,
  onClear,
}: {
  pending: "test" | "save" | "clear" | null;
  /** The connection is known, so there is something to test. */
  testable: boolean;
  /** A key is typed and this computer can keep it. */
  savable: boolean;
  saved: boolean;
  result: McpConnectionTestOutcome | null;
  onTest: () => void;
  onClear: () => void;
}) {
  return (
    <div className={styles["component-editor__test"]}>
      <button
        className="button"
        type="button"
        disabled={pending !== null || !testable}
        onClick={onTest}
      >
        {pending === "test" ? "Testing…" : "Test connection"}
      </button>
      <button
        className="button button--accent"
        type="submit"
        disabled={pending !== null || !savable}
      >
        {pending === "save" ? "Saving…" : "Save token"}
      </button>
      {saved && (
        <button
          className="button button--quiet"
          type="button"
          disabled={pending !== null}
          onClick={onClear}
        >
          {pending === "clear" ? "Removing…" : "Remove saved token"}
        </button>
      )}
      {result?.ok === true && (
        <span
          className={`${styles["component-editor__test-status"]} ${styles["component-editor__test-status--ok"]}`}
          role="status"
        >
          <Icon name="check" />
          Connected · {result.tools.length}{" "}
          {result.tools.length === 1 ? "tool" : "tools"} found
        </span>
      )}
      {result?.ok === false && (
        <span
          className={styles["component-editor__test-status--failed"]}
          role="alert"
        >
          {result.reason}
        </span>
      )}
    </div>
  );
}

/** A connector's tools, each switched on or off for the model. */
export function ConnectorTools({
  tools,
  empty,
  onSetToolEnabled,
}: {
  tools: readonly McpToolSummary[];
  /** What is said where there are none. */
  empty: string;
  onSetToolEnabled: (toolName: string, enabled: boolean) => Promise<void>;
}) {
  return (
    <fieldset className={styles["component-editor__tools"]}>
      <legend>Tools</legend>
      {tools.length === 0 ? (
        <p className={styles["component-editor__tools-empty"]}>{empty}</p>
      ) : (
        <ul>
          {tools.map((tool) => (
            <li key={tool.name}>
              <label
                className={
                  tool.withheld
                    ? styles["component-editor__tool--withheld"]
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={tool.enabled && !tool.withheld}
                  disabled={Boolean(tool.withheld)}
                  onChange={(event) =>
                    void onSetToolEnabled(tool.name, event.target.checked)
                  }
                />
                <span>
                  <strong data-tip={tool.name}>{inWords(tool.name)}</strong>
                  {tool.description && <small>{tool.description}</small>}
                  {tool.withheld && (
                    <small className={styles["component-editor__tool-reason"]}>
                      {tool.withheld}
                    </small>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
