/**
 * The sections of a declared connector's settings: what it is, whether it
 * answers, how its key is made and kept, which of its tools may be used, and
 * how each is treated when used.
 * Each shows what the dialog holds and hands back what the person did.
 */

import { useId } from "react";
import type {
  ConnectionToolTreatment,
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
export const withArticle = (noun: string) =>
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
  keyLabel,
}: {
  component: PluginComponentState;
  server: McpServerState | undefined;
  /** The connector is reached with a key, so the state of one is said. */
  usesKey: boolean;
  /** What the key is called, as a heading: "API key". */
  keyLabel: string;
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
          <dt>{keyLabel}</dt>
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
          Turning it on allows nothing by itself: Zhiyin still asks before any
          action through it that needs your decision.
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
  serviceName,
  saved,
  unavailable,
  token,
  onChange,
}: {
  /** What the key is called on the field. */
  label: string;
  keyName: string;
  /** The service the key is made on, which is the connector's name. */
  serviceName: string;
  saved: boolean;
  /** This computer has no secure storage to keep a key in. */
  unavailable: boolean;
  token: string;
  onChange: (token: string) => void;
}) {
  if (unavailable)
    return (
      <p className={styles["component-editor__error"]} role="alert">
        {`This computer has no secure storage, so the ${keyName} cannot be saved.`}
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
            : `Paste the ${keyName} from ${serviceName}`
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
  keyName,
  pending,
  testable,
  savable,
  saved,
  result,
  onTest,
  onClear,
}: {
  keyName: string;
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
        {pending === "save" ? "Saving…" : `Save ${keyName}`}
      </button>
      {saved && (
        <button
          className="button button--quiet"
          type="button"
          disabled={pending !== null}
          onClick={onClear}
        >
          {pending === "clear" ? "Removing…" : `Remove saved ${keyName}`}
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

/** How a tool of a connection the person added may be treated, as offered. */
const treatments: readonly {
  value: ConnectionToolTreatment;
  label: string;
}[] = [
  { value: "ask-once", label: "Ask once per conversation" },
  { value: "ask-each-time", label: "Ask every time" },
  { value: "only-reads", label: "Only reads — don't ask" },
];

/**
 * The tools as a test found them, each switched on or off and treated as the
 * connection feature last said: a test saves nothing, so it knows nothing of
 * that, and finds every tool on.
 */
export function toolsShown(
  tested: McpConnectionTestOutcome | null | undefined,
  saved: readonly McpToolSummary[],
): readonly McpToolSummary[] {
  if (!tested?.ok) return saved;
  return tested.tools.map((tool) => {
    const kept = saved.find(({ name }) => name === tool.name);
    if (!kept) return tool;
    return {
      ...tool,
      enabled: tool.enabled && kept.enabled,
      ...(kept.treatment ? { treatment: kept.treatment } : {}),
    };
  });
}

/**
 * A connector's tools, each switched on or off for the model. A tool of a
 * connection the person added also says how it is treated when used. With
 * none, it says whether the connector has none or has not connected yet,
 * in the same words for a connector a plugin declares and one the person
 * added.
 */
export function ConnectorTools({
  tools,
  connected,
  onSetToolEnabled,
  onSetToolTreatment,
}: {
  tools: readonly McpToolSummary[];
  /** The connector answered, so a list with no tools means it has none. */
  connected: boolean;
  onSetToolEnabled: (toolName: string, enabled: boolean) => Promise<void>;
  /** Absent where the choice cannot be saved. */
  onSetToolTreatment?:
    | ((
        toolName: string,
        treatment: ConnectionToolTreatment,
        shown: string,
      ) => Promise<void>)
    | undefined;
}) {
  return (
    <fieldset className={styles["component-editor__tools"]}>
      <legend>Tools</legend>
      {tools.length === 0 ? (
        <p className={styles["component-editor__tools-empty"]}>
          {connected
            ? "This connector offers no tools."
            : "Tools appear once this connector connects."}
        </p>
      ) : (
        <ul>
          {tools.map((tool) => (
            <ConnectorTool
              key={tool.name}
              tool={tool}
              onSetToolEnabled={onSetToolEnabled}
              onSetToolTreatment={onSetToolTreatment}
            />
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function ConnectorTool({
  tool,
  onSetToolEnabled,
  onSetToolTreatment,
}: {
  tool: McpToolSummary;
  onSetToolEnabled: (toolName: string, enabled: boolean) => Promise<void>;
  onSetToolTreatment:
    | ((
        toolName: string,
        treatment: ConnectionToolTreatment,
        shown: string,
      ) => Promise<void>)
    | undefined;
}) {
  const warning = useId();
  const usable = tool.enabled && !tool.withheld;
  const onlyReads = tool.treatment === "only-reads";
  return (
    <li className={styles["component-editor__tool"]}>
      <label
        className={
          tool.withheld ? styles["component-editor__tool--withheld"] : undefined
        }
      >
        <input
          type="checkbox"
          checked={usable}
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
      {tool.treatment && onSetToolTreatment && (
        <select
          className={styles["component-editor__tool-treatment"]}
          aria-label={`When Zhiyin uses ${inWords(tool.name)}`}
          aria-describedby={onlyReads ? warning : undefined}
          value={tool.treatment}
          disabled={!usable}
          onChange={(event) =>
            void onSetToolTreatment(
              tool.name,
              event.target.value as ConnectionToolTreatment,
              tool.version ?? "",
            ).catch(() => undefined)
          }
        >
          {treatments.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {onlyReads && onSetToolTreatment && (
        <small
          id={warning}
          className={styles["component-editor__tool-warning"]}
        >
          Zhiyin cannot check that it only reads: your word is what counts.
        </small>
      )}
    </li>
  );
}
