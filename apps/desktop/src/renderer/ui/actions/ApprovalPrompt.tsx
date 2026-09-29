import { useId, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ApprovalRequest,
  FileChange,
  ToolInvocation,
} from "@zhiyin/contract";
import { DiffModal } from "./DiffModal.js";
import { ToolCallView } from "./ToolCallView.js";
import { Icon } from "../shared/index.js";
import styles from "./actions.module.css";

export type ApprovalDecision = "allow-once" | "allow-conversation" | "deny";

type ApprovalPromptProps = {
  effect?: string;
  detail?: string;
  claim?: string;
  destination?: string;
  title: string;
  target: string;
  description?: string;
  command: string;
  invocation?: ToolInvocation;
  changes?: readonly FileChange[];
  recovery?: ApprovalRequest["recovery"];
  conversationRule?: ApprovalRequest["conversationRule"];
  /** Tighter spacing, for a conversation sharing the window with the browser. */
  compact?: boolean;
  onDecision: (
    decision: ApprovalDecision,
    reason?: string,
  ) => void | Promise<void>;
};

/**
 * The one screen where a person is asked to take responsibility for something
 * they may not be able to read. Its order is the order the decision is
 * actually made in, and nothing may be inserted above that order:
 *
 *   1. what the action is, in a few words;
 *   2. what it can do to their machine — authoritative, true of every such
 *      action, and never written by the model;
 *   3. what Zhiyin says this particular one is for — clearly attributed,
 *      because it is a claim and not evidence;
 *   4. the exact command or structured inputs, or, for a file change, the
 *      file and its proposed difference on request.
 *
 * Raw tool-call syntax belongs in the action's inspector after the decision.
 * The command itself remains whole when a shell command is what will run.
 */
export function ApprovalPrompt({
  effect,
  detail,
  claim,
  destination,
  title,
  target,
  description,
  invocation,
  changes,
  recovery,
  conversationRule,
  compact = false,
  onDecision,
}: ApprovalPromptProps) {
  const [reviewing, setReviewing] = useState(false);
  const [denying, setDenying] = useState(false);
  const [pendingDecision, setPendingDecision] =
    useState<ApprovalDecision | null>(null);
  const [decisionError, setDecisionError] = useState<string>();
  const [denialReason, setDenialReason] = useState("");
  const [confirmingScope, setConfirmingScope] = useState(false);
  const claimTipId = useId();
  const [claimTipAt, setClaimTipAt] = useState<{ x: number; y: number }>();
  const showClaimTip = (target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    setClaimTipAt({ x: box.left + box.width / 2, y: box.top });
  };
  const actionAlreadyNamed = invocation?.name === title && !invocation.via;

  async function decide(decision: ApprovalDecision) {
    if (pendingDecision) return;
    setPendingDecision(decision);
    setDecisionError(undefined);
    try {
      if (decision === "deny" && denialReason.trim())
        await onDecision(decision, denialReason.trim());
      else await onDecision(decision);
      setPendingDecision(null);
    } catch {
      setPendingDecision(null);
      setDecisionError("The decision could not be sent. Try again.");
    }
  }

  return (
    <section
      className={`${styles.approval}${compact ? ` ${styles["approval--compact"]}` : ""}`}
      aria-label="Permission request"
    >
      <div className={styles.approval__icon}>
        <Icon name="lock" />
      </div>
      <div className={styles.approval__content}>
        <div className={styles.approval__summary}>
          <h3>{title}</h3>
          {effect && effect !== title && (
            <p className={styles.approval__effect}>{effect}</p>
          )}
          {detail && !changes?.length && (
            <p className={styles.approval__detail}>{detail}</p>
          )}
          {claim && (
            <p className={styles.approval__claim}>
              <span>
                Zhiyin says this is for
                <button
                  type="button"
                  className={styles["approval__claim-about"]}
                  aria-label="About this AI explanation"
                  aria-describedby={claimTipAt ? claimTipId : undefined}
                  onMouseEnter={(event) => showClaimTip(event.currentTarget)}
                  onMouseLeave={() => setClaimTipAt(undefined)}
                  onFocus={(event) => showClaimTip(event.currentTarget)}
                  onBlur={() => setClaimTipAt(undefined)}
                >
                  <Icon name="info" />
                </button>
              </span>
              {claim}
              {claimTipAt &&
                createPortal(
                  <span
                    id={claimTipId}
                    role="tooltip"
                    className={styles["approval__claim-tip"]}
                    style={{ left: claimTipAt.x, top: claimTipAt.y }}
                  >
                    This explanation was written by the AI. It can be wrong or
                    deliberately misleading. Check what will run and what will
                    change before you approve.
                  </span>,
                  document.body,
                )}
            </p>
          )}
          {description && description !== claim && (
            <p className={styles.approval__reason}>{description}</p>
          )}
          {destination && (
            <div className={styles.approval__destination}>
              <span>Connection</span>
              <strong>{destination}</strong>
              <p>This request sends these inputs to this connection.</p>
            </div>
          )}
          {changes?.length ? (
            <div className={styles.approval__target}>
              <span>What will change</span>
              <ul className={styles["approval__file-list"]}>
                {changes.map((change) => (
                  <li key={change.path}>
                    <span className={styles["approval__file-kind"]}>
                      {change.change === "created" ? "New file" : "Edit file"}
                    </span>
                    <code>{change.path}</code>
                    {change.createdFolder && (
                      <small>Also creates folder {change.createdFolder}</small>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : invocation ? (
            (!actionAlreadyNamed || invocation.arguments.length > 0) && (
              <ToolCallView
                invocation={invocation}
                label="What will run"
                hideName={actionAlreadyNamed}
              />
            )
          ) : (
            <div className={styles.approval__target}>
              <span>What will run</span>
              <code>{target}</code>
            </div>
          )}
          {/*
            A file change is reviewed as a difference, never as the call that
            would make it. Nobody consents to replacing a file by reading
            `write_file({"path":…,"text":…})`; the question they are
            answering is which lines go and which arrive.
          */}
          {!!changes?.length && (
            <button
              className={`text-button ${styles.approval__review}`}
              type="button"
              disabled={pendingDecision !== null}
              onClick={() => setReviewing(true)}
            >
              <Icon name="file" />
              {changes.length === 1
                ? "Review this change"
                : `Review ${changes.length} changed files`}
            </button>
          )}
          {recovery?.files.some((file) => file.status === "unprotected") && (
            <div
              className={styles.approval__recovery}
              aria-label="File recovery"
            >
              <p>Some file changes cannot be restored after this action.</p>
              <ul>
                {recovery.files
                  .filter((file) => file.status === "unprotected")
                  .map((file) => (
                    <li key={file.path}>
                      <strong>{file.path}</strong>
                      {file.reason && <span>{file.reason}</span>}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
        {decisionError && (
          <p className={styles.approval__error} role="alert">
            {decisionError}
          </p>
        )}
        {denying && (
          <div className={styles["approval__deny-step"]}>
            <strong>Deny this action</strong>
            <label className={styles["approval__denial-reason"]}>
              <span>Tell Zhiyin what to do instead (optional)</span>
              <textarea
                autoFocus
                value={denialReason}
                onChange={(event) => setDenialReason(event.target.value)}
                placeholder="You can leave this blank"
                maxLength={2_000}
                disabled={pendingDecision !== null}
              />
            </label>
          </div>
        )}
        {confirmingScope && conversationRule && (
          <p className={styles["approval__scope-confirm"]}>
            Allow for this conversation:{" "}
            <strong>{conversationRule.label}</strong>
            <span>
              {" "}
              Future matching actions will run without another prompt. You can
              revoke this permission from the conversation menu.
            </span>
          </p>
        )}
        <div className={styles.approval__footer}>
          <div className={styles.approval__actions}>
            {denying ? (
              <>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={pendingDecision !== null}
                  onClick={() => setDenying(false)}
                >
                  Back
                </button>
                <button
                  className="button button--accent"
                  type="button"
                  disabled={pendingDecision !== null}
                  onClick={() => void decide("deny")}
                >
                  {pendingDecision === "deny" ? "Denying…" : "Confirm denial"}
                </button>
              </>
            ) : confirmingScope && conversationRule ? (
              <>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={pendingDecision !== null}
                  onClick={() => setConfirmingScope(false)}
                >
                  Back
                </button>
                <button
                  className="button button--accent"
                  type="button"
                  disabled={pendingDecision !== null}
                  onClick={() => void decide("allow-conversation")}
                >
                  Allow for this conversation
                </button>
              </>
            ) : (
              <>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={pendingDecision !== null}
                  onClick={() => setDenying(true)}
                >
                  Deny
                </button>
                {conversationRule && (
                  <button
                    className="button button--quiet"
                    type="button"
                    disabled={pendingDecision !== null}
                    onClick={() => setConfirmingScope(true)}
                  >
                    Allow for this conversation
                  </button>
                )}
                <button
                  className="button button--accent"
                  type="button"
                  disabled={pendingDecision !== null}
                  onClick={() => void decide("allow-once")}
                >
                  {pendingDecision === "allow-once"
                    ? "Allowing…"
                    : "Allow once"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {reviewing && !!changes?.length && (
        <DiffModal changes={changes} onClose={() => setReviewing(false)} />
      )}
    </section>
  );
}
