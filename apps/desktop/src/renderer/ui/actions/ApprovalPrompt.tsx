import { useEffect, useId, useRef, useState } from "react";
import type {
  ApprovalRequest,
  FileChange,
  ToolInvocation,
} from "@zhiyin/contract";
import { ApprovalChoice, type ApprovalDecision } from "./ApprovalChoice.js";
import { ApprovalEvidence } from "./ApprovalEvidence.js";
import { DiffModal } from "./DiffModal.js";
import { Icon, PointedTip, visibleText } from "../shared/index.js";
import styles from "./actions.module.css";

type ApprovalPromptProps = {
  effect?: string;
  detail?: string;
  claim?: string;
  destination?: string;
  title: string;
  target: string;
  description?: string;
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
  const [reviewing, setReviewing] = useState<string>();
  const [denying, setDenying] = useState(false);
  const [pendingDecision, setPendingDecision] =
    useState<ApprovalDecision | null>(null);
  const [decisionError, setDecisionError] = useState<string>();
  const [denialReason, setDenialReason] = useState("");
  const [confirmingScope, setConfirmingScope] = useState(false);
  const scopeConfirm = useRef<HTMLDivElement>(null);
  // The question takes the place of the button that asked it, which is gone:
  // focus moves to it, so the keyboard and a screen reader follow.
  useEffect(() => {
    if (confirmingScope) scopeConfirm.current?.focus();
  }, [confirmingScope]);
  const [claimTipAt, setClaimTipAt] = useState<{ x: number; y: number }>();

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

  const kind = kindOf({ changes, destination, invocation, title, effect });

  return (
    <section
      className={`${styles.approval}${compact ? ` ${styles["approval--compact"]}` : ""}`}
      aria-label="Permission request"
    >
      <div className={styles.approval__content}>
        <header className={styles.approval__head}>
          <span className={styles.approval__kind} aria-hidden="true">
            <Icon name={kind} />
          </span>
          <h3>{visibleText(title)}</h3>
        </header>
        <div className={styles.approval__summary}>
          {effect && effect !== title && (
            <p className={styles.approval__effect}>{effect}</p>
          )}
          {/* A deletion's detail is its warning, and the list cannot say it. */}
          {detail &&
            (!changes?.length ||
              changes.some(
                (item) =>
                  item.change === "recycled" || item.change === "deleted",
              )) && <p className={styles.approval__detail}>{detail}</p>}
          {claim && (
            <ApprovalClaim
              claim={visibleText(claim)}
              tipAt={claimTipAt}
              onTip={setClaimTipAt}
            />
          )}
          {description && description !== claim && (
            <p className={styles.approval__reason}>
              {visibleText(description)}
            </p>
          )}
          {destination && (
            <p className={styles.approval__destination}>
              Sends this to <strong>{visibleText(destination)}</strong>:
            </p>
          )}
          <ApprovalEvidence
            title={title}
            target={target}
            invocation={invocation}
            changes={changes}
            disabled={pendingDecision !== null}
            onReview={setReviewing}
          />
          <UnrestorableFiles recovery={recovery} />
        </div>
        {decisionError && (
          <p className={styles.approval__error} role="alert">
            {decisionError}
          </p>
        )}
        <ApprovalChoice
          pending={pendingDecision}
          denial={{
            open: denying,
            reason: denialReason,
            onOpen: () => setDenying(true),
            onBack: () => setDenying(false),
            onReason: setDenialReason,
          }}
          scope={
            conversationRule && {
              label: conversationRule.label,
              confirming: confirmingScope,
              onAsk: () => setConfirmingScope(true),
              onBack: () => setConfirmingScope(false),
            }
          }
          scopeQuestion={scopeConfirm}
          onDecide={(decision) => void decide(decision)}
        />
      </div>
      {reviewing && !!changes?.length && (
        <DiffModal
          changes={changes}
          about={title}
          initialPath={reviewing}
          onClose={() => setReviewing(undefined)}
        />
      )}
    </section>
  );
}

/**
 * What Zhiyin says this action is for, attributed to it. The note beside the
 * attribution says why that matters: the model wrote it, so it is a claim to
 * check and not evidence. The note opens over the page, where the prompt says.
 */
function ApprovalClaim({
  claim,
  tipAt: claimTipAt,
  onTip: setClaimTipAt,
}: {
  claim: string;
  /** Where the note is drawn, while it is shown. */
  tipAt: { x: number; y: number } | undefined;
  onTip: (at: { x: number; y: number } | undefined) => void;
}) {
  const claimTipId = useId();
  const showClaimTip = (target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    setClaimTipAt({ x: box.left + box.width / 2, y: box.top });
  };
  return (
    <p className={styles.approval__claim}>
      <span>
        Zhiyin says
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
      </span>{" "}
      {claim}
      {claimTipAt && (
        <PointedTip id={claimTipId} at={claimTipAt}>
          This explanation was written by the AI. It can be wrong or
          deliberately misleading. Check what will run and what will change
          before you approve.
        </PointedTip>
      )}
    </p>
  );
}

/** The files this action changes that could not be put back afterwards. */
function UnrestorableFiles({
  recovery,
}: {
  recovery: ApprovalRequest["recovery"];
}) {
  if (!recovery?.files.some((file) => file.status === "unprotected"))
    return null;
  return (
    <div className={styles.approval__recovery} aria-label="File recovery">
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
  );
}

type IconName = Parameters<typeof Icon>[0]["name"];

/**
 * What kind of action this is, drawn as the card's one icon so a request reads
 * at a glance. Only what the request itself establishes is used; a request
 * that establishes nothing gets the plain lock.
 */
function kindOf({
  changes,
  destination,
  invocation,
  title,
  effect,
}: {
  changes: readonly FileChange[] | undefined;
  destination: string | undefined;
  invocation: ToolInvocation | undefined;
  title: string;
  effect: string | undefined;
}): IconName {
  if (changes?.length) return "file";
  if (destination || invocation?.via) return "plug";
  const said =
    `${effect ?? ""} ${title} ${invocation?.name ?? ""}`.toLowerCase();
  if (/shell|command|bash|powershell/.test(said)) return "code";
  if (/browser|page|web/.test(said)) return "globe";
  return "lock";
}
