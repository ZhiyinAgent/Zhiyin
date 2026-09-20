import { useState } from "react";
import type { ApiKeySaveOutcome, ProviderSettings } from "@zhiyin/contract";
import { Dialog } from "../shared/index.js";
import styles from "./model.module.css";

/**
 * Where the key is entered, replaced and removed.
 *
 * Saving is a network-backed change that can be refused, so the dialog has a
 * pending state and reports a failure in place rather than closing as though it
 * had worked.
 */
export function ApiKeyDialog({
  credential,
  onClose,
  onSaveApiKey,
  onClearApiKey,
}: {
  credential: ProviderSettings["credential"];
  onClose: () => void;
  onSaveApiKey: (apiKey: string) => Promise<ApiKeySaveOutcome>;
  onClearApiKey: () => Promise<void>;
}) {
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
      title="OpenRouter API key"
      onClose={onClose}
      footer={
        <>
          <span
            className={`${styles["model-key-status"]}${credential.status === "missing" ? ` ${styles["model-key-status--missing"]}` : ""}`}
          >
            {credential.status === "configured"
              ? "Connected"
              : credential.status === "missing"
                ? "No key"
                : "Storage unavailable"}
          </span>
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
          The key comes from the development environment, so it cannot be
          changed here.
        </p>
      )}

      {stored && !replacing && (
        <p className={styles["model-key-value"]} aria-label="Stored API key">
          sk-or-v1-••••••••••••••••••••••••••••
        </p>
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
          <label>
            <span>Paste your key</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-or-v1-…"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
        </form>
      )}

      {failure && (
        <p
          className={`${styles["model-key-note"]} ${styles["model-key-note--failed"]}`}
          role="alert"
        >
          {failure}
        </p>
      )}
    </Dialog>
  );
}
