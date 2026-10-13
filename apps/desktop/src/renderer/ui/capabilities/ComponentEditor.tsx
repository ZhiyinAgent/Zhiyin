import { useRef, useState } from "react";
import type {
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  McpToolSummary,
} from "@zhiyin/contract";
import { Dialog } from "../shared/index.js";
import { useConnectorSignIn } from "./connectorSignIn.js";
import {
  AccessChoice,
  SignInCard,
  type AccessMode,
} from "./ConnectorAccess.js";
import {
  ConnectorAddressFields,
  ConnectorDisclosureFields,
  ConnectorTestNote,
  ConnectorTokenField,
  SkillFields,
  SpecialistFields,
} from "./ComponentFields.js";
import { ConnectorTools } from "./ConnectorSections.js";
import { slugify, type ComponentDraft } from "./componentDrafts.js";
import styles from "./capabilities.module.css";

const kindLabel: Record<ComponentDraft["kind"], string> = {
  skill: "skill",
  specialist: "specialist",
  connection: "connector",
};

type Pending = "save" | "remove" | "token" | "sign-out" | null;

/**
 * The editor's buttons: Done once a new connector is saved and only its
 * sign-in is left, the question before a removal, and otherwise Remove, Test
 * connection and Save.
 */
function EditorActions({
  stage,
  label,
  pending,
  removal,
  test,
  onClose,
}: {
  stage: "saved" | "confirming-removal" | "editing";
  /** The kind of component, as it is called on the page. */
  label: string;
  pending: Pending;
  removal: {
    readonly offered: boolean;
    readonly onAsk: () => void;
    readonly onKeep: () => void;
    readonly onConfirm: () => void;
  };
  /** Absent where there is nothing to test. */
  test?:
    | {
        readonly running: boolean;
        readonly incomplete: boolean;
        readonly onRun: () => void;
      }
    | undefined;
  onClose: () => void;
}) {
  if (stage === "saved")
    return (
      <button className="button" type="button" onClick={onClose}>
        Done
      </button>
    );
  if (stage === "confirming-removal")
    return (
      <>
        <span role="alert">Remove this {label}?</span>
        <button
          className="button"
          type="button"
          disabled={pending !== null}
          onClick={removal.onKeep}
        >
          Keep it
        </button>
        <button
          className="button button--accent"
          type="button"
          disabled={pending !== null}
          onClick={removal.onConfirm}
        >
          {pending === "remove" ? "Removing…" : "Remove"}
        </button>
      </>
    );
  return (
    <>
      {removal.offered && (
        <button
          className={`button button--quiet ${styles["component-editor__footer-start"]}`}
          type="button"
          disabled={pending !== null}
          onClick={removal.onAsk}
        >
          Remove
        </button>
      )}
      {test && (
        <button
          className="button"
          type="button"
          disabled={test.running || pending !== null || test.incomplete}
          onClick={test.onRun}
        >
          {test.running ? "Testing…" : "Test connection"}
        </button>
      )}
      <button
        className="button button--accent"
        type="submit"
        form="component-editor-form"
        disabled={pending !== null}
      >
        {pending === "save" ? "Saving…" : "Save"}
      </button>
    </>
  );
}

/**
 * One component's edit form in a plugin made in the app, shaped to its kind.
 * Saving hands back the component's full content; the caller folds it into
 * the plugin's complete component list, which is saved as a new version.
 */
export function ComponentEditor({
  draft,
  connectionState,
  onSave,
  onSaveToken,
  onRemove,
  onTest,
  onSetToolEnabled,
  onSignIn,
  onCancelSignIn,
  onSignOut,
  onClose,
}: {
  /** `undefined` id means this is a new component being created. */
  draft: ComponentDraft;
  /** Live status and discovered tools, for an existing connector. */
  connectionState?: {
    readonly status: McpServerState["status"];
    readonly tools: readonly McpToolSummary[];
    readonly tokenSaved: boolean;
    /** Present when the service has its own sign-in. */
    readonly account?: "signed-out" | "signed-in";
  };
  onSave: (draft: ComponentDraft) => Promise<void>;
  /** Saves a token for the connector with this local id, once it is saved. */
  onSaveToken?: (localId: string, token: string) => Promise<void>;
  onRemove?: () => Promise<void>;
  onTest?: (
    server: McpServerDefinition,
    token?: string,
  ) => Promise<McpConnectionTestOutcome>;
  onSetToolEnabled?: (toolName: string, enabled: boolean) => Promise<void>;
  /** Opens the service's own sign-in for the connector with this local id. */
  onSignIn?: (localId: string) => Promise<McpSignInOutcome>;
  onCancelSignIn?: (localId: string) => Promise<void>;
  onSignOut?: (localId: string) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = draft.id === "";
  const [form, setForm] = useState<ComponentDraft>(draft);
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<McpConnectionTestOutcome | null>(
    null,
  );
  const [testing, setTesting] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  // A new connector has its id once it is saved; signing in comes after.
  const savedId = useRef<string | undefined>(isNew ? undefined : draft.id);
  const closeWhenSignedIn = useRef(false);
  const [savedForSignIn, setSavedForSignIn] = useState(false);
  const signIn = useConnectorSignIn(
    onSignIn ? () => onSignIn(savedId.current ?? draft.id) : undefined,
    () => {
      if (closeWhenSignedIn.current) onClose();
    },
  );
  const [chosenMode, setChosenMode] = useState<AccessMode>();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const name = form.kind === "skill" ? form.id : form.name;
  const nameInvalid = attempted && !name.trim();
  const descriptionInvalid =
    (form.kind === "skill" || form.kind === "specialist") &&
    attempted &&
    !form.description.trim();
  const instructionsInvalid =
    (form.kind === "skill" || form.kind === "specialist") &&
    attempted &&
    !form.instructions.trim();
  const urlInvalid =
    form.kind === "connection" && attempted && !isHttpUrl(form.url);
  const missing = {
    name: nameInvalid,
    description: descriptionInvalid,
    instructions: instructionsInvalid,
  };

  // What is known about the account holds for the address it was saved at.
  const account =
    connectionState?.tokenSaved ||
    draft.kind !== "connection" ||
    form.kind !== "connection" ||
    form.url !== draft.url
      ? undefined
      : connectionState?.account;
  const tokenSaved = connectionState?.tokenSaved === true;
  const signedIn = account === "signed-in";
  // What the form asks for: the person's choice, else what the service is
  // known to offer, else sign-in for a new one and a token for one that works.
  const mode: AccessMode =
    chosenMode ??
    (tokenSaved
      ? "token"
      : account
        ? "sign-in"
        : isNew || connectionState?.status !== "connected"
          ? "sign-in"
          : "token");
  // Saving never waits on a test or a sign-in: a connector is checked once it
  // is saved, and signed in to, or given a token, now or later.
  const offersSignInAfterSave =
    isNew && mode === "sign-in" && onSignIn !== undefined;
  const tools = testResult?.ok
    ? testResult.tools
    : (connectionState?.tools ?? []);

  function isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  async function test() {
    if (form.kind !== "connection" || !onTest || testing) return;
    setTesting(true);
    setError(null);
    try {
      const result = await onTest(
        {
          id: form.id || slugify(form.name),
          name: form.name,
          url: form.url,
          enabled: true,
        },
        mode === "token" ? token.trim() || undefined : undefined,
      );
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setAttempted(true);
    if (form.kind === "skill" || form.kind === "specialist") {
      if (!name.trim() || !form.description.trim() || !form.instructions.trim())
        return;
    } else {
      if (!form.name.trim() || !isHttpUrl(form.url)) return;
    }
    setPending("save");
    setError(null);
    try {
      const saved: ComponentDraft =
        form.kind === "skill"
          ? { ...form, id: form.id || slugify(form.id) }
          : { ...form, id: form.id || slugify(form.name) };
      await onSave(saved);
      if (
        saved.kind === "connection" &&
        mode === "token" &&
        token.trim() &&
        onSaveToken
      )
        await onSaveToken(saved.id, token.trim());
      if (offersSignInAfterSave) {
        // Saved: the dialog stays to offer the sign-in, which may wait, and
        // closes once one succeeds.
        savedId.current = saved.id;
        closeWhenSignedIn.current = true;
        setSavedForSignIn(true);
        return;
      }
      onClose();
    } catch {
      setError(`Could not save this ${kindLabel[form.kind]}.`);
    } finally {
      setPending(null);
    }
  }

  async function signOut() {
    if (!onSignOut) return;
    setPending("sign-out");
    setError(null);
    try {
      await onSignOut(savedId.current ?? draft.id);
    } catch {
      setError("Could not sign out.");
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (!onRemove) return;
    setPending("remove");
    setError(null);
    try {
      await onRemove();
      onClose();
    } catch {
      setError(`Could not remove this ${kindLabel[form.kind]}.`);
      setPending(null);
    }
  }

  const title = isNew
    ? `New ${kindLabel[form.kind]}`
    : `Edit ${kindLabel[form.kind]}`;

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <EditorActions
          stage={
            savedForSignIn
              ? "saved"
              : confirmingRemoval
                ? "confirming-removal"
                : "editing"
          }
          label={kindLabel[form.kind]}
          pending={pending}
          removal={{
            offered: !isNew && onRemove !== undefined,
            onAsk: () => setConfirmingRemoval(true),
            onKeep: () => setConfirmingRemoval(false),
            onConfirm: () => void remove(),
          }}
          test={
            form.kind === "connection" && onTest && !signedIn
              ? {
                  running: testing,
                  incomplete: !form.name.trim() || !isHttpUrl(form.url),
                  onRun: () => void test(),
                }
              : undefined
          }
          onClose={onClose}
        />
      }
    >
      <form
        id="component-editor-form"
        className={styles["component-editor__form"]}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {form.kind === "skill" && (
          <SkillFields
            form={form}
            isNew={isNew}
            invalid={missing}
            onChange={setForm}
          />
        )}

        {form.kind === "specialist" && (
          <SpecialistFields form={form} invalid={missing} onChange={setForm} />
        )}

        {form.kind === "connection" && savedForSignIn && (
          <>
            <p className={styles["component-editor__note"]}>
              {form.name} is saved. You can sign in now or later.
            </p>
            <SignInCard
              name={form.name}
              signedIn={false}
              signingIn={signIn.signingIn}
              failure={signIn.failure}
              busy={pending !== null}
              onSignIn={() => void signIn.start()}
              onCancel={() =>
                void onCancelSignIn?.(savedId.current ?? draft.id)
              }
              onSignOut={() => undefined}
            />
          </>
        )}
        {form.kind === "connection" && !savedForSignIn && (
          <>
            <ConnectorAddressFields
              form={form}
              invalid={{ name: nameInvalid, url: urlInvalid }}
              onChange={(next) => {
                setForm(next);
                setTestResult(null);
              }}
            />
            {!signedIn && !tokenSaved && (
              <AccessChoice
                mode={mode}
                onChange={(next) => {
                  setChosenMode(next);
                  setTestResult(null);
                }}
              />
            )}
            {mode === "token" && !signedIn && (
              <ConnectorTokenField
                token={token}
                saved={tokenSaved}
                onChange={(next) => {
                  setToken(next);
                  setTestResult(null);
                }}
              />
            )}
            {(signedIn ||
              signIn.signingIn ||
              (!isNew && mode === "sign-in")) && (
              <SignInCard
                name={form.name}
                signedIn={signedIn}
                signingIn={signIn.signingIn}
                failure={signIn.failure}
                busy={pending !== null}
                onSignIn={() => void signIn.start()}
                onCancel={() =>
                  void onCancelSignIn?.(savedId.current ?? draft.id)
                }
                onSignOut={() => void signOut()}
              />
            )}
            <ConnectorTestNote result={testResult} mode={mode} />
            <ConnectorDisclosureFields form={form} onChange={setForm} />
            {!isNew && connectionState && onSetToolEnabled && (
              <ConnectorTools
                tools={tools}
                empty={
                  connectionState.status === "connected" || testResult?.ok
                    ? "This server does not advertise any tools."
                    : "Tools will appear once this server connects."
                }
                onSetToolEnabled={onSetToolEnabled}
              />
            )}
          </>
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
