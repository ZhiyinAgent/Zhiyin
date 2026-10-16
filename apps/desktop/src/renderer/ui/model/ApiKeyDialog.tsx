import { useId, useRef, useState } from "react";
import type { ApiKeySaveOutcome, ProviderSettings } from "@zhiyin/contract";
import { Dialog } from "../shared/index.js";
import styles from "./model.module.css";

/**
 * Where the key for one provider's platform is entered, replaced and removed.
 *
 * Saving is a network-backed change that can be refused, so the dialog has a
 * pending state and reports a failure in place rather than closing as though it
 * had worked.
 */
export function ApiKeyDialog({
  providerName,
  platformName,
  keysPage,
  credential,
  onClose,
  onSaveApiKey,
  onClearApiKey,
  onOpenExternalUrl,
}: {
  /** Who the key is for, as the person reads it. */
  providerName: string;
  /** The lab's platform the key belongs to, where it runs two. */
  platformName?: string;
  /** The provider's page where keys are made and deleted. */
  keysPage?: string;
  credential: ProviderSettings["credential"];
  onClose: () => void;
  onSaveApiKey: (apiKey: string) => Promise<ApiKeySaveOutcome>;
  onClearApiKey: () => Promise<void>;
  /** Opens the provider's page where keys are made and deleted. */
  onOpenExternalUrl?: (url: string) => Promise<void>;
}) {
  const inputId = useId();
  const failureId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const stored =
    credential.status === "configured" &&
    credential.source === "credentialStore";
  const fromEnvironment =
    credential.status === "configured" && credential.source === "environment";
  const entering = credential.status === "missing" || replacing;
  const kept = (
    <p className={styles["model-key-where"]}>
      Zhiyin keeps the key in Windows Credential Manager and sends it only to{" "}
      {providerName}.
    </p>
  );

  async function save() {
    if (!apiKey.trim() || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await onSaveApiKey(apiKey);
      if (outcome.status === "refused") {
        // The provider's own words. Ours would be a guess at a refusal we did
        // not make, and "not accepted" fits a wrong key, a spent account and a
        // revoked one equally badly.
        setFailure(outcome.reason);
        // Back where another key is pasted: Save was disabled while it was
        // checked, which took focus away.
        field.current?.focus();
        field.current?.select();
        return;
      }
      setApiKey("");
      setReplacing(false);
      // A key that could not be checked has still been kept, so the dialog is
      // done with; saying so anywhere it can be missed would be worse than
      // saying it here before it closes.
      if (outcome.status === "unverified") {
        setFailure(outcome.reason);
        return;
      }
      onClose();
    } catch {
      setFailure("The key could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await onClearApiKey();
      setReplacing(false);
    } catch {
      setFailure("The key could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={
        platformName
          ? `${providerName} API key · ${platformName}`
          : `${providerName} API key`
      }
      onClose={onClose}
      footer={
        <>
          {credential.status !== "missing" && (
            <span
              className={`${styles["model-key-status"]}${credential.status === "unavailable" ? ` ${styles["model-key-status--missing"]}` : ""}`}
            >
              {credential.status === "configured"
                ? "Connected"
                : "Storage unavailable"}
            </span>
          )}
          <span className={styles["model-key-dialog__actions"]}>
            {stored && !replacing && (
              <>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busy}
                  onClick={() => void clear()}
                >
                  Remove
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => setReplacing(true)}
                >
                  Replace
                </button>
              </>
            )}
            {entering && (
              <button
                className="button button--accent"
                type="submit"
                form="model-key-form"
                disabled={busy || !apiKey.trim()}
                data-tip={!apiKey.trim() ? "Paste a key first" : undefined}
              >
                {busy ? "Saving…" : "Save key"}
              </button>
            )}
          </span>
        </>
      }
    >
      {credential.status === "unavailable" && (
        <p className={styles["model-key-note"]} role="alert">
          {credential.reason}
        </p>
      )}

      {fromEnvironment && (
        <p className={styles["model-key-note"]}>
          This key was set for an automated run, by a variable whose name starts
          with ZHIYIN_. Remove the variable and restart Zhiyin to save a key
          here.
        </p>
      )}

      {stored && !replacing && (
        <div className={styles["model-key-saved"]}>
          <span
            className={styles["model-key-value"]}
            aria-label="Stored API key"
          >
            ••••••••••••••••••••••••••••
          </span>
          {kept}
          <p className={styles["model-key-where"]}>
            Remove only makes Zhiyin forget it. To stop it working anywhere,
            delete it on {providerName}'s keys page.
          </p>
        </div>
      )}

      {entering && (
        <div className={styles["model-key-intro"]}>
          <p>
            The key lets Zhiyin use AI models through your {providerName}{" "}
            account. {providerName} charges that account for what Zhiyin uses.
          </p>
          {onOpenExternalUrl && keysPage && (
            <button
              className="button button--small"
              type="button"
              onClick={() => void onOpenExternalUrl(keysPage)}
            >
              Get a key on {providerName}
            </button>
          )}
        </div>
      )}

      {entering && (
        <form
          id="model-key-form"
          className={styles["model-key-form"]}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className={styles["model-key-label"]} htmlFor={inputId}>
            Paste your key
          </label>
          <input
            id={inputId}
            ref={field}
            type="password"
            aria-describedby={failure ? failureId : undefined}
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          {kept}
        </form>
      )}

      {failure && (
        <p
          id={failureId}
          className={`${styles["model-key-note"]} ${styles["model-key-note--failed"]}`}
          role="alert"
        >
          {failure}
        </p>
      )}
    </Dialog>
  );
}
