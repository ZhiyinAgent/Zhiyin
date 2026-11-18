import { useRef, useState } from "react";
import type {
  ConnectionToolTreatment,
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  McpToolSummary,
} from "@zhiyin/contract";
import { ConfirmChoice, Dialog } from "../shared/index.js";
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
import { ConnectorTools, toolsShown } from "./ConnectorSections.js";
import {
  nameProblem,
  slugify,
  type ComponentDraft,
} from "./componentDrafts.js";
import styles from "./capabilities.module.css";

const kindLabel: Record<ComponentDraft["kind"], string> = {
  skill: "skill",
  specialist: "specialist",
  connection: "connector",
};

type Pending = "save" | "remove" | "token" | "sign-out" | null;

/**
 * The editor's buttons: the question before a removal, and otherwise Remove,
 * Test connection and Save. Once a new connector is saved and only its
 * sign-in is left there are none; the dialog closes from its header.
 */
function EditorActions({
  stage,
  label,
  pending,
  removal,
  test,
}: {
  stage: "confirming-removal" | "editing";
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
}) {
  if (stage === "confirming-removal")
    return (
      <ConfirmChoice
        question={`Remove this ${label}?`}
        keep="Keep it"
        act={pending === "remove" ? "Removing…" : "Remove"}
        busy={pending !== null}
        onKeep={removal.onKeep}
        onAct={removal.onConfirm}
      />
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
  holderOf,
  connectionState,
  onSave,
  onSaveToken,
  onRemove,
  onTest,
  onSetToolEnabled,
  onSetToolTreatment,
  onSignIn,
  onCancelSignIn,
  onSignOut,
  onClose,
}: {
  /** `undefined` id means this is a new component being created. */
  draft: ComponentDraft;
  /** The kind of another component of the plugin with this id, if any. */
  holderOf?: (localId: string) => string | undefined;
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
  onRemove?: (() => Promise<void>) | undefined;
  onTest?: (
    server: McpServerDefinition,
    token?: string,
  ) => Promise<McpConnectionTestOutcome>;
  /** Switches a tool of the connector with this local id, once it is saved. */
  onSetToolEnabled?: (
    localId: string,
    toolName: string,
    enabled: boolean,
  ) => Promise<void>;
  /** How a tool of the saved connection is treated when used. */
  onSetToolTreatment?: (
    toolName: string,
    treatment: ConnectionToolTreatment,
    shown: string,
  ) => Promise<void>;
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
  // Saved, but its token or its tool choices could not be kept.
  const [partlySaved, setPartlySaved] = useState(false);
  // The tools the person switched in this form: a saved connector's at once,
  // a new one's once it is saved.
  const [switched, setSwitched] = useState<Readonly<Record<string, boolean>>>(
    {},
  );
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

  const name = form.name;
  const nameInvalid = attempted ? nameProblem(name) : undefined;
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
  const tools = toolsShown(testResult, connectionState?.tools ?? []).map(
    (tool) =>
      tool.name in switched && !tool.withheld
        ? { ...tool, enabled: switched[tool.name]! }
        : tool,
  );

  async function switchTool(toolName: string, enabled: boolean) {
    setSwitched((now) => ({ ...now, [toolName]: enabled }));
    if (isNew || !onSetToolEnabled) return;
    try {
      await onSetToolEnabled(draft.id, toolName, enabled);
    } catch {
      setSwitched((now) => ({ ...now, [toolName]: !enabled }));
      setError("Could not switch this tool.");
    }
  }

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
          id: form.id || slugify(form.name, "connector"),
          name: form.name,
          url: form.url,
          enabled: true,
        },
        mode === "token" ? token.trim() || undefined : undefined,
      );
      setTestResult(result);
    } catch {
      setError("The connection could not be tested.");
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setAttempted(true);
    if (form.kind === "skill" || form.kind === "specialist") {
      if (
        nameProblem(name) ||
        !form.description.trim() ||
        !form.instructions.trim()
      )
        return;
    } else {
      if (nameProblem(form.name) || !isHttpUrl(form.url)) return;
    }
    setPending("save");
    setError(null);
    const saved: ComponentDraft =
      form.kind === "skill"
        ? { ...form, id: isNew ? slugify(form.name, "skill") : form.id }
        : {
            ...form,
            id:
              form.id ||
              slugify(
                form.name,
                form.kind === "specialist" ? "specialist" : "connector",
              ),
          };
    const holder = holderOf?.(saved.id);
    if (holder) {
      setError(
        `This plugin already has a ${holder} named ${saved.id}. Choose another name.`,
      );
      setPending(null);
      return;
    }
    let step: "save" | "token" | "tools" = "save";
    try {
      await onSave(saved);
      step = "token";
      if (
        saved.kind === "connection" &&
        mode === "token" &&
        token.trim() &&
        onSaveToken
      )
        await onSaveToken(saved.id, token.trim());
      step = "tools";
      // A new connector's tools are on until the person switched one off.
      if (isNew && saved.kind === "connection" && onSetToolEnabled)
        for (const [toolName, enabled] of Object.entries(switched))
          if (!enabled) await onSetToolEnabled(saved.id, toolName, false);
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
      if (step === "save")
        setError(`Could not save this ${kindLabel[form.kind]}.`);
      else {
        // Saved already, so the dialog offers no second save, which would
        // add it twice.
        savedId.current = saved.id;
        setPartlySaved(true);
        setError(
          step === "token"
            ? `${name} is saved, but its access token could not be kept. Open it again to enter it.`
            : `${name} is saved, but which tools it may use could not be kept. Open it again to switch them.`,
        );
      }
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
        savedForSignIn || partlySaved ? undefined : (
          <EditorActions
            stage={confirmingRemoval ? "confirming-removal" : "editing"}
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
          />
        )
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
        {form.kind === "connection" && !savedForSignIn && !partlySaved && (
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
            {/* Under what the test found: a new connector's tools as soon as
                a test lists them, a saved one's always. */}
            {onSetToolEnabled &&
              ((!isNew && connectionState) || testResult?.ok) && (
                <ConnectorTools
                  tools={tools}
                  connected={
                    connectionState?.status === "connected" ||
                    testResult?.ok === true
                  }
                  onSetToolEnabled={switchTool}
                  onSetToolTreatment={isNew ? undefined : onSetToolTreatment}
                />
              )}
            <ConnectorDisclosureFields form={form} onChange={setForm} />
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
