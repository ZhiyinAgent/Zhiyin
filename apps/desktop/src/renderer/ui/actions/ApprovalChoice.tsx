import { useId, type RefObject } from "react";
import { visibleText } from "../shared/index.js";
import styles from "./actions.module.css";

export type ApprovalDecision = "allow-once" | "allow-conversation" | "deny";

/**
 * The decision's controls, as the step the decision has reached. Denying
 * takes a second step, where the person may say what to do instead. Allowing
 * for the rest of the conversation is asked about once, in the place of the
 * button that offered it, with what it will cover. The prompt holds where the
 * decision stands; this draws it.
 */
export function ApprovalChoice({
  pending,
  denial,
  scope,
  scopeQuestion,
  onDecide,
}: {
  /** The decision being sent, which holds every control until it settles. */
  pending: ApprovalDecision | null;
  /** The second step of a denial, and what the person wrote in it. */
  denial: {
    readonly open: boolean;
    readonly reason: string;
    readonly onOpen: () => void;
    readonly onBack: () => void;
    readonly onReason: (reason: string) => void;
  };
  /** Allowing for the conversation, where the request offers it. */
  scope:
    | {
        /** What the allowance would cover. */
        readonly label: string;
        readonly confirming: boolean;
        readonly onAsk: () => void;
        readonly onBack: () => void;
      }
    | undefined;
  /** The question asked before allowing, which the prompt gives focus to. */
  scopeQuestion: RefObject<HTMLDivElement | null>;
  onDecide: (decision: ApprovalDecision) => void;
}) {
  const scopeId = useId();
  const scopeQuestionId = useId();
  return (
    <>
      {denial.open && (
        <div className={styles["approval__deny-step"]}>
          <strong>Deny this action</strong>
          <label className={styles["approval__denial-reason"]}>
            <span>Tell Zhiyin what to do instead (optional)</span>
            <textarea
              autoFocus
              value={denial.reason}
              onChange={(event) => denial.onReason(event.target.value)}
              placeholder="You can leave this blank"
              maxLength={2_000}
              disabled={pending !== null}
            />
          </label>
        </div>
      )}
      <div className={styles.approval__footer}>
        {scope?.confirming && (
          <div
            ref={scopeQuestion}
            className={styles["approval__scope-confirm"]}
            role="group"
            aria-labelledby={scopeQuestionId}
            tabIndex={-1}
          >
            <strong id={scopeQuestionId}>
              Allow this for the rest of the conversation?
            </strong>
            <span>
              <span>{visibleText(scope.label)}</span>
              <small>Undo it any time in the conversation menu.</small>
            </span>
          </div>
        )}
        {!denial.open && scope && !scope.confirming && (
          <button
            className={styles.approval__allowance}
            type="button"
            aria-label="Allow for this conversation"
            aria-describedby={scopeId}
            disabled={pending !== null}
            onClick={scope.onAsk}
          >
            <span>Allow for this conversation</span>
            <small id={scopeId}>{visibleText(scope.label)}</small>
          </button>
        )}
        <div className={styles.approval__actions}>
          {denial.open ? (
            <>
              <button
                className="button button--quiet"
                type="button"
                disabled={pending !== null}
                onClick={denial.onBack}
              >
                Back
              </button>
              <button
                className="button button--accent"
                type="button"
                disabled={pending !== null}
                onClick={() => onDecide("deny")}
              >
                {pending === "deny" ? "Denying…" : "Confirm denial"}
              </button>
            </>
          ) : scope?.confirming ? (
            <>
              <button
                className="button button--quiet"
                type="button"
                disabled={pending !== null}
                onClick={scope.onBack}
              >
                Back
              </button>
              <button
                className="button button--accent"
                type="button"
                disabled={pending !== null}
                onClick={() => onDecide("allow-conversation")}
              >
                {pending === "allow-conversation" ? "Allowing…" : "Allow"}
              </button>
            </>
          ) : (
            <>
              <button
                className="button"
                type="button"
                disabled={pending !== null}
                onClick={denial.onOpen}
              >
                Deny
              </button>
              <button
                className="button button--accent"
                type="button"
                disabled={pending !== null}
                onClick={() => onDecide("allow-once")}
              >
                {pending === "allow-once" ? "Allowing…" : "Allow once"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
