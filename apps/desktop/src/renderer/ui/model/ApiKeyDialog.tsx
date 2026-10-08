import { useId, useState } from "react";
import type { ApiKeySaveOutcome, ProviderSettings } from "@zhiyin/contract";
import { OPENROUTER_KEYS_URL } from "@zhiyin/contract";
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
  onOpenExternalUrl,
}: {
  credential: ProviderSettings["credential"];
  onClose: () => void;
  onSaveApiKey: (apiKey: string) => Promise<ApiKeySaveOutcome>;
  onClearApiKey: () => Promise<void>;
  /** Opens OpenRouter's page where keys are made and deleted. */
  onOpenExternalUrl?: (url: string) => Promise<void>;
}) {
  const inputId = useId();
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
      Zhiyin keeps the key in Windows Credential Manager and sends it only to
      OpenRouter.
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
          The key comes from the development environment, so it cannot be
          changed here.
        </p>
      )}

      {stored && !replacing && (
        <div className={styles["model-key-saved"]}>
          <span
            className={styles["model-key-value"]}
            aria-label="Stored API key"
          >
            sk-or-v1-••••••••••••••••••••••••••••
          </span>
          {kept}
          <p className={styles["model-key-where"]}>
            Remove only makes Zhiyin forget it. To stop it working anywhere,
            delete it on OpenRouter's keys page.
          </p>
        </div>
      )}

      {entering && (
        <div className={styles["model-key-intro"]}>
          <p>
            The key lets Zhiyin use AI models through your OpenRouter account.
            OpenRouter charges that account for what Zhiyin uses.
          </p>
          {onOpenExternalUrl && (
            <button
              className="button button--small"
              type="button"
              onClick={() => void onOpenExternalUrl(OPENROUTER_KEYS_URL)}
            >
              Get a key on OpenRouter
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
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-or-v1-…"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          {kept}
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
