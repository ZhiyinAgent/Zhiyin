import { useState } from "react";
import type {
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  PluginComponentState,
} from "@zhiyin/contract";
import { Dialog, Icon } from "../shared/index.js";
import styles from "./capabilities.module.css";

/**
 * Setting up a connector its plugin declares: the endpoint belongs to the
 * package, so what a person manages here is the access token and which of the
 * server's tools may be used.
 */
export function ConnectorSettings({
  component,
  server,
  onTest,
  onSaveToken,
  onClearToken,
  onSetToolEnabled,
  onClose,
}: {
  component: PluginComponentState;
  /** The live connection, once the connection feature has looked at it. */
  server: McpServerState | undefined;
  onTest: (
    server: McpServerDefinition,
    token?: string,
  ) => Promise<McpConnectionTestOutcome>;
  onSaveToken: (token: string) => Promise<void>;
  onClearToken: () => Promise<void>;
  onSetToolEnabled: (toolName: string, enabled: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<McpConnectionTestOutcome | null>(
    null,
  );
  const [pending, setPending] = useState<"test" | "save" | "clear" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const tokenSaved = server?.credential.status === "saved";
  const storageUnavailable = server?.credential.status === "unavailable";
  const tools = testResult?.ok ? testResult.tools : (server?.tools ?? []);

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
    } catch {
      setError("Could not remove the access token.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog
      title={`Set up ${component.name}`}
      onClose={onClose}
      className={styles["component-editor"] ?? ""}
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
        </dl>
        {component.detail && (
          <p className={styles["component-editor__changed"]} role="status">
            {component.detail}
          </p>
        )}
        {storageUnavailable ? (
          <p className={styles["component-editor__error"]} role="alert">
            Secure storage for access tokens is unavailable on this computer, so
            a token cannot be saved.
          </p>
        ) : (
          <label>
            <span>{tokenSaved ? "Replace access token" : "Access token"}</span>
            <input
              aria-label="Access token"
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
        <div className={styles["component-editor__test"]}>
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
            disabled={pending !== null || !token.trim() || storageUnavailable}
          >
            {pending === "save" ? "Saving…" : "Save token"}
          </button>
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
        {server && (
          <fieldset className={styles["component-editor__tools"]}>
            <legend>Tools</legend>
            {tools.length === 0 ? (
              <p className={styles["component-editor__tools-empty"]}>
                {server.status === "connected" || testResult?.ok
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
                        <strong>{tool.name}</strong>
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
