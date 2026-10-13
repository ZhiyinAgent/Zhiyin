import { useEffect, useState } from "react";
import type {
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  PluginComponentState,
} from "@zhiyin/contract";
import { Dialog } from "../shared/index.js";
import { useConnectorSignIn } from "./connectorSignIn.js";
import {
  AccessChoice,
  SignInCard,
  type AccessMode,
} from "./ConnectorAccess.js";
import {
  ConnectionCheck,
  ConnectorFacts,
  ConnectorTools,
  KeyActions,
  KeyField,
  KeySetupSteps,
  type Check,
} from "./ConnectorSections.js";
import styles from "./capabilities.module.css";

const capitalized = (text: string) => text[0]?.toUpperCase() + text.slice(1);

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
        <ConnectorFacts
          component={component}
          server={server}
          usesKey={keyField}
        />
        <ConnectionCheck
          check={check}
          component={component}
          keyName={keyName}
          refusalShown={refusalShown}
          busy={pending !== null}
          onRetry={() => void runCheck()}
        />
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
          <KeySetupSteps
            name={component.name}
            keyName={keyName}
            setup={setup}
            onOpenExternalUrl={onOpenExternalUrl}
          />
        )}
        {keyField && (
          <KeyField
            label={keyLabel}
            keyName={keyName}
            saved={tokenSaved}
            unavailable={storageUnavailable}
            token={token}
            onChange={(next) => {
              setToken(next);
              setTestResult(null);
            }}
          />
        )}
        {keyField && (
          <KeyActions
            pending={pending}
            testable={server !== undefined}
            savable={token.trim() !== "" && !storageUnavailable}
            saved={tokenSaved}
            result={testResult}
            onTest={() => void test()}
            onClear={() => void clear()}
          />
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
          <ConnectorTools
            tools={tools}
            empty={
              current?.status === "connected" || testResult?.ok
                ? "This server does not offer any tools."
                : "Tools appear once this connector connects."
            }
            onSetToolEnabled={onSetToolEnabled}
          />
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
