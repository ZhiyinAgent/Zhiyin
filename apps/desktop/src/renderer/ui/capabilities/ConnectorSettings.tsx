import { useEffect, useId, useState } from "react";
import type {
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  PluginComponentState,
} from "@zhiyin/contract";
import { Dialog, Icon } from "../shared/index.js";
import { inWords } from "./names.js";
import { useConnectorSignIn } from "./connectorSignIn.js";
import {
  AccessChoice,
  SignInCard,
  type AccessMode,
} from "./ConnectorAccess.js";
import styles from "./capabilities.module.css";

type Check =
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

const capitalized = (text: string) => text[0]?.toUpperCase() + text.slice(1);

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

/**
 * Setting up a connector its plugin declares: the endpoint belongs to the
 * package, so what a person manages here is the access token, or the sign-in
 * when the service has its own, and which of the server's tools may be used.
 */
export function ConnectorSettings({
  component,
  server,
  onTest,
  onCheck,
  onSaveToken,
  onClearToken,
  onSignIn,
  onCancelSignIn,
  onSetToolEnabled,
  onOpenExternalUrl,
  onClose,
}: {
  component: PluginComponentState;
  /** The live connection, once the connection feature has looked at it. */
  server: McpServerState | undefined;
  onTest: (
    server: McpServerDefinition,
    token?: string,
  ) => Promise<McpConnectionTestOutcome>;
  /** Reaches the connector now; nothing else does until a conversation uses it. */
  onCheck: (id: string) => Promise<McpServerState>;
  onSaveToken: (token: string) => Promise<void>;
  onClearToken: () => Promise<void>;
  /** Opens the service's own sign-in in the person's browser. */
  onSignIn: () => Promise<McpSignInOutcome>;
  onCancelSignIn: () => Promise<void>;
  onSetToolEnabled: (toolName: string, enabled: boolean) => Promise<void>;
  /** Opens the service's own page where its key is made. */
  onOpenExternalUrl: (url: string) => Promise<void>;
  onClose: () => void;
}) {
  const setupHeading = useId();
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<McpConnectionTestOutcome | null>(
    null,
  );
  const [pending, setPending] = useState<"test" | "save" | "clear" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [chosenMode, setChosenMode] = useState<AccessMode>();
  const id = component.id;
  const checkable = component.enabled && server !== undefined;
  const [check, setCheck] = useState<Check | undefined>(() =>
    checkable ? { status: "checking" } : undefined,
  );
  // Whichever answer is newer: a check's, or the window's after a change.
  const current =
    check?.status === "answered" &&
    (server?.checkedAt ?? -1) < (check.state.checkedAt ?? check.at)
      ? check.state
      : server;

  async function runCheck() {
    setCheck({ status: "checking" });
    try {
      const state = await onCheck(id);
      setCheck({ status: "answered", state, at: Date.now() });
    } catch {
      setCheck({ status: "unreachable" });
    }
  }

  const signIn = useConnectorSignIn(onSignIn, () => {
    if (checkable) void runCheck();
  });

  // Opening a connector's settings is the person asking whether it works.
  useEffect(() => {
    if (!checkable) return;
    let live = true;
    onCheck(id).then(
      (state) => {
        if (live) setCheck({ status: "answered", state, at: Date.now() });
      },
      () => {
        if (live) setCheck({ status: "unreachable" });
      },
    );
    return () => {
      live = false;
    };
  }, [checkable, id, onCheck]);

  const tokenSaved = server?.credential.status === "saved";
  const signedIn = server?.credential.status === "signed-in";
  const storageUnavailable = server?.credential.status === "unavailable";
  // The service's own sign-in, when it has one, comes before a key.
  const offersSignIn = (current?.signIn ?? server?.signIn) === true;
  // Nothing held yet, and both ways in open: the person chooses.
  const choosing =
    offersSignIn && !tokenSaved && !signedIn && !storageUnavailable;
  const mode: AccessMode = chosenMode ?? "sign-in";
  const signInWay = signedIn || (choosing && mode === "sign-in");
  const setup = component.setup;
  const keyField = !signInWay;
  const keyName = setup?.keyName ?? "access token";
  const keyLabel = setup ? capitalized(keyName) : "Access token";
  // A refused key needs a new one made, as much as a missing one does.
  const showSteps =
    setup !== undefined &&
    !storageUnavailable &&
    keyField &&
    (!tokenSaved || current?.status === "unauthorized");
  // A refusal for want of a sign-in is said by the sign-in card, not twice.
  const refusalShown = !(
    signInWay &&
    check?.status === "answered" &&
    check.state.status === "unauthorized"
  );
  const tools = testResult?.ok ? testResult.tools : (current?.tools ?? []);

  async function test() {
    if (!server) return;
    setPending("test");
    setError(null);
    try {
      setTestResult(
        await onTest(
          { id: server.id, name: server.name, url: server.url, enabled: true },
          token.trim() || undefined,
        ),
      );
    } finally {
      setPending(null);
    }
  }

  async function save() {
    if (!token.trim()) return;
    setPending("save");
    setError(null);
    try {
      await onSaveToken(token.trim());
      setToken("");
      setTestResult(null);
      if (checkable) void runCheck();
    } catch {
      setError("Could not save the access token.");
    } finally {
      setPending(null);
    }
  }

  async function clear() {
    setPending("clear");
    setError(null);
    try {
      await onClearToken();
      if (checkable) void runCheck();
    } catch {
      setError(
        signedIn ? "Could not sign out." : "Could not remove the access token.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog
      title={`Set up ${component.name}`}
      onClose={onClose}
      footer={
        <button className="button" type="button" onClick={onClose}>
          Done
        </button>
      }
    >
      <form
        className={styles["component-editor__form"]}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className={styles["component-editor__note"]}>
          {component.description}
        </p>
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
          {server && keyField && (
            <div>
              <dt>Key</dt>
              <dd>
                {tokenSaved
                  ? "Saved"
                  : storageUnavailable
                    ? "Cannot be saved on this computer"
                    : "Not saved"}
              </dd>
            </div>
          )}
        </dl>
        {check ? (
          (check.status !== "answered" ||
            check.state.status === "connected" ||
            refusalShown) && (
            <div className={styles["component-editor__test"]}>
              {check.status === "checking" && (
                <span
                  className={styles["component-editor__test-status"]}
                  role="status"
                >
                  Checking connection…
                </span>
              )}
              {check.status === "answered" &&
                check.state.status === "connected" && (
                  <span
                    className={`${styles["component-editor__test-status"]} ${styles["component-editor__test-status--ok"]}`}
                    role="status"
                  >
                    <Icon name="check" />
                    Connected ·{" "}
                    {checkedWhen(check.state.checkedAt ?? check.at, check.at)}
                  </span>
                )}
              {(check.status === "unreachable" ||
                (check.status === "answered" &&
                  (check.state.status === "failed" ||
                    check.state.status === "unauthorized"))) &&
                refusalShown && (
                  <>
                    <span
                      className={
                        styles["component-editor__test-status--failed"]
                      }
                      role="alert"
                    >
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
                    </span>
                    <button
                      className="button"
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void runCheck()}
                    >
                      Retry
                    </button>
                  </>
                )}
            </div>
          )
        ) : !component.enabled ? (
          <p className={styles["component-editor__changed"]} role="status">
            This connector is off. Turn it on in the plugin&apos;s list to use
            it. Turning it on allows nothing by itself: Zhiyin still asks before
            each action it takes, unless you allow that action for the
            conversation.
          </p>
        ) : (
          component.detail && (
            <p className={styles["component-editor__changed"]} role="status">
              {component.detail}
            </p>
          )
        )}
        {choosing && (
          <AccessChoice
            mode={mode}
            onChange={(next) => {
              setChosenMode(next);
              setTestResult(null);
            }}
          />
        )}
        {(signInWay || signIn.signingIn) && (
          <SignInCard
            name={component.name}
            signedIn={signedIn}
            signingIn={signIn.signingIn}
            failure={signIn.failure}
            busy={pending !== null}
            onSignIn={() => void signIn.start()}
            onCancel={() => void onCancelSignIn()}
            onSignOut={() => void clear()}
          />
        )}
        {showSteps && (
          <section
            className={styles["connector-setup"]}
            aria-labelledby={setupHeading}
          >
            <h3 id={setupHeading}>How to set up</h3>
            <ol>
              <li>
                {`Create ${withArticle(keyName)} on ${component.name}'s site.${setup.advice ? ` ${setup.advice}` : ""}`}
                <button
                  type="button"
                  className={styles["connector-setup__open"]}
                  onClick={() => void onOpenExternalUrl(setup.url)}
                >
                  Open {component.name}
                </button>
              </li>
              <li>Paste it below and save it.</li>
              <li>Test the connection.</li>
            </ol>
            <p>
              {`${component.name} acts with whatever the ${keyName} allows. You can skip this connector: Zhiyin works without it.`}
            </p>
          </section>
        )}
        {!keyField ? null : storageUnavailable ? (
          <p className={styles["component-editor__error"]} role="alert">
            Secure storage for access tokens is unavailable on this computer, so
            a token cannot be saved.
          </p>
        ) : (
          <label>
            <span>{tokenSaved ? `Replace ${keyName}` : keyLabel}</span>
            <input
              aria-label={keyLabel}
              type="password"
              autoComplete="off"
              placeholder={
                tokenSaved
                  ? "Saved — paste a new one to replace it"
                  : "Paste the token from the service"
              }
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setTestResult(null);
              }}
            />
          </label>
        )}
        {keyField && (
          <div className={styles["component-editor__test"]}>
            {keyField && (
              <>
                <button
                  className="button"
                  type="button"
                  disabled={pending !== null || !server}
                  onClick={() => void test()}
                >
                  {pending === "test" ? "Testing…" : "Test connection"}
                </button>
                <button
                  className="button button--accent"
                  type="submit"
                  disabled={
                    pending !== null || !token.trim() || storageUnavailable
                  }
                >
                  {pending === "save" ? "Saving…" : "Save token"}
                </button>
              </>
            )}
            {tokenSaved && (
              <button
                className="button button--quiet"
                type="button"
                disabled={pending !== null}
                onClick={() => void clear()}
              >
                {pending === "clear" ? "Removing…" : "Remove saved token"}
              </button>
            )}
            {testResult?.ok === true && (
              <span
                className={`${styles["component-editor__test-status"]} ${styles["component-editor__test-status--ok"]}`}
                role="status"
              >
                <Icon name="check" />
                Connected · {testResult.tools.length}{" "}
                {testResult.tools.length === 1 ? "tool" : "tools"} found
              </span>
            )}
            {testResult?.ok === false && (
              <span
                className={styles["component-editor__test-status--failed"]}
                role="alert"
              >
                {testResult.reason}
              </span>
            )}
          </div>
        )}
        {setup && tokenSaved && (
          <details className={styles["connector-setup__revoke"]}>
            <summary>Taking the key back</summary>
            <p>
              {`Remove saved token only makes Zhiyin forget it. To stop it working anywhere, delete it on ${component.name}'s site.`}
            </p>
          </details>
        )}
        {server && (
          <fieldset className={styles["component-editor__tools"]}>
            <legend>Tools</legend>
            {tools.length === 0 ? (
              <p className={styles["component-editor__tools-empty"]}>
                {current?.status === "connected" || testResult?.ok
                  ? "This server does not offer any tools."
                  : "Tools appear once this connector connects."}
              </p>
            ) : (
              <ul>
                {tools.map((tool) => (
                  <li key={tool.name}>
                    <label>
                      <input
                        type="checkbox"
                        checked={tool.enabled}
                        onChange={(event) =>
                          void onSetToolEnabled(tool.name, event.target.checked)
                        }
                      />
                      <span>
                        <strong data-tip={tool.name}>
                          {inWords(tool.name)}
                        </strong>
                        {tool.description && <small>{tool.description}</small>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}
        {error && (
          <p className={styles["component-editor__error"]} role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
