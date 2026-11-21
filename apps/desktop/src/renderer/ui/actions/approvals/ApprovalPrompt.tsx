import { Fragment, useEffect, useRef, useState } from "react";
import type {
  ActionEffects,
  ApprovalRequest,
  FileChange,
  ToolInvocation,
} from "@zhiyin/contract";
import { ActionKind, AskedReasons } from "../ActionCard.js";
import {
  actionKind,
  askedReason,
  oneEntryPerMove,
  type AskedWhy,
} from "../actionFacts.js";
import { accountOf } from "../actionWords.js";
import { ApprovalAccount } from "./ApprovalAccount.js";
import {
  ApprovalChoice,
  type AnswerWords,
  type ApprovalDecision,
  type GrantOffer,
} from "./ApprovalChoice.js";
import { ApprovalEvidence, commandOf } from "./ApprovalEvidence.js";
import { readOnItsOwn } from "../change-review/CodeReview.js";
import { codeTab, DiffModal } from "../change-review/DiffModal.js";
import { Icon, visibleText } from "../../shared/index.js";
import styles from "./approvals.module.css";

type ApprovalPromptProps = {
  effect?: string;
  detail?: string | undefined;
  claim?: string | undefined;
  /** Every place what it sends goes, the first tried first. */
  destinations?: readonly string[] | undefined;
  title: string;
  target: string;
  description?: string;
  /** The description was written by the AI, so it is shown as its claim. */
  descriptionByModel?: boolean;
  invocation?: ToolInvocation | undefined;
  changes?: readonly FileChange[];
  recovery?: ApprovalRequest["recovery"];
  /** What the action does, as the code that owns it declared. */
  effects?: ActionEffects | undefined;
  /** Which part of the policy asks, which the card explains. */
  why?: AskedWhy;
  conversationRule?: ApprovalRequest["conversationRule"];
  /** For a change by Zhiyin's own file tools, its file and its folder, each one click. */
  fileRules?: ApprovalRequest["fileRules"];
  /** What sealed-off commands reach, whose answer holds for the conversation. */
  reach?: ApprovalRequest["reach"];
  /** Tighter spacing, for a conversation sharing the window with the browser. */
  compact?: boolean;
  /**
   * The request has just arrived and is answered from the keyboard: focus
   * moves to it, unless a person is writing or a dialog is open.
   */
  takesFocus?: boolean;
  onDecision: (
    decision: ApprovalDecision,
    reason?: string,
  ) => void | Promise<void>;
};

/**
 * The card an action shows while it asks: the asking state of the one card
 * design every action has. It is the one screen where a person is asked to
 * take responsibility for something they may not be able to read. Its order
 * is the order the decision is actually made in, and nothing may be inserted
 * above that order:
 *
 *   1. what the action is, in a few words, and the marks of what it does;
 *   2. what it can do to their machine, why they are asked and what no
 *      protects — authoritative, and never written by the model;
 *   3. what the AI says this particular one is for — clearly attributed,
 *      because it is a claim and not evidence;
 *   4. the exact command or structured inputs, or, for a file change, the
 *      file and its proposed difference on request.
 *
 * Raw tool-call syntax belongs under Technical details. The command itself
 * remains whole when a shell command is what will run.
 */
export function ApprovalPrompt({
  effect,
  detail,
  claim,
  destinations,
  title,
  target,
  description,
  descriptionByModel = false,
  invocation,
  changes,
  recovery,
  effects,
  why,
  conversationRule,
  fileRules,
  reach,
  compact = false,
  takesFocus = false,
  onDecision,
}: ApprovalPromptProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!takesFocus) return;
    const active = document.activeElement;
    const writing =
      (active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement) &&
      active.value.trim() !== "";
    if (writing || document.querySelector('[aria-modal="true"]')) return;
    heading.current?.focus();
  }, [takesFocus]);
  const [reviewing, setReviewing] = useState<string>();
  const command = commandOf(invocation)?.value;
  const longCode =
    command !== undefined && readOnItsOwn(command) ? command : undefined;
  const [denying, setDenying] = useState(false);
  const [pendingDecision, setPendingDecision] =
    useState<ApprovalDecision | null>(null);
  const [decisionError, setDecisionError] = useState<string>();
  const [denialReason, setDenialReason] = useState("");
  const account = accountOf({ description, descriptionByModel, claim });
  // Where an action acts as the person is its mark's to say; the card lists
  // every other place what it sends goes.
  const places = (destinations ?? []).filter(
    (place) =>
      Boolean(place) &&
      !(effects?.destination === place && effects.actsAsPerson !== "none"),
  );

  const asked = askedReason(why, effects);
  // A move is one file to decide on, though it names both ends.
  const files = changes && oneEntryPerMove(changes);

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
      <div className={styles.approval__content}>
        <header className={styles.approval__head}>
          <ActionKind
            asking
            name={actionKind({
              effects,
              changes,
              connector: Boolean(invocation?.via || places.length),
            })}
          />
          <h3 ref={heading} tabIndex={-1}>
            {visibleText(title)}
          </h3>
        </header>
        {reach?.kind === "confirm" ? (
          <ReachToKeep since={reach.since} places={reach.places} />
        ) : (
          <div className={styles.approval__summary}>
            {asked && <AskedReasons reason={asked} />}
            {effect && effect !== title && (
              <p className={styles.approval__effect}>{visibleText(effect)}</p>
            )}
            {/*
            A deletion's detail is its warning, and the list cannot say it;
            nor can a list of files none of whose changes can be shown.
          */}
            {detail &&
              (!changes?.length ||
                changes.every((item) => item.omitted !== undefined) ||
                changes.some(
                  (item) =>
                    item.change === "recycled" || item.change === "deleted",
                )) && (
                <p className={styles.approval__detail}>{visibleText(detail)}</p>
              )}
            {/* Said once, though the request may give it as both. */}
            {account.ours && account.ours !== detail && (
              <p className={styles.approval__reason}>
                {visibleText(account.ours)}
              </p>
            )}
            <ApprovalAccount
              claim={account.model && visibleText(account.model)}
            />
            {places.length ? (
              <p className={styles.approval__destination}>
                Sends this to{" "}
                {places.map((place, index) => (
                  <Fragment key={place}>
                    {index === 0
                      ? ""
                      : index === places.length - 1
                        ? " or "
                        : ", "}
                    <strong>{visibleText(place)}</strong>
                  </Fragment>
                ))}
                :
              </p>
            ) : null}
            <ApprovalEvidence
              title={title}
              target={target}
              invocation={invocation}
              changes={files}
              disabled={pendingDecision !== null}
              onReview={setReviewing}
              onReviewCode={() => setReviewing(codeTab)}
            />
            <UnrestorableFiles recovery={recovery} />
          </div>
        )}
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
          offers={grantOffers(fileRules, conversationRule)}
          {...(reach ? { words: reachWords[reach.kind] } : {})}
          onDecide={(decision) => void decide(decision)}
        />
      </div>
      {reviewing !== undefined && (!!changes?.length || longCode) && (
        <DiffModal
          changes={files ?? []}
          code={longCode}
          about={title}
          initialPath={reviewing === codeTab ? undefined : reviewing}
          onClose={() => setReviewing(undefined)}
        />
      )}
    </section>
  );
}

/**
 * What answering a request about what commands reach does: it holds for the
 * rest of the conversation, so neither answer says "once".
 */
const reachWords: Record<
  NonNullable<ApprovalRequest["reach"]>["kind"],
  AnswerWords
> = {
  grant: {
    allow: "Allow for this conversation",
    allowing: "Allowing…",
    deny: "Deny",
    denying: "Denying…",
    note: true,
  },
  confirm: {
    allow: "Keep for this conversation",
    allowing: "Keeping…",
    deny: "Take back",
    denying: "Taking back…",
    note: false,
  },
};

/**
 * Whether to keep what commands reach, now the conversation holds more than
 * when it was allowed: why it asks, in one sentence, then each place as a
 * row, a website by its globe and a folder by its folder.
 */
function ReachToKeep({
  since,
  places,
}: Omit<
  Extract<NonNullable<ApprovalRequest["reach"]>, { kind: "confirm" }>,
  "kind"
>) {
  return (
    <div className={styles.approval__summary}>
      <p className={styles.approval__reason}>{visibleText(since)}</p>
      <ul
        className={styles["approval__file-list"]}
        aria-label="What commands may reach"
      >
        {places.map((place) => (
          <li key={place.label} className={styles.approval__place}>
            <span className={styles["approval__file-icon"]}>
              <Icon name={place.kind === "folder" ? "folder" : "globe"} />
            </span>
            <span className={styles["approval__file-name"]}>
              {visibleText(place.label)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Every grant for the rest of the conversation the request offers, each named
 * by what it covers: the file or the folder outside the conversation's folder
 * a change is in, then the rule the core proposes. In full, the folder is its
 * whole path; on its button, its own name.
 */
function grantOffers(
  fileRules: ApprovalRequest["fileRules"],
  rule: ApprovalRequest["conversationRule"],
): GrantOffer[] {
  return [
    ...(fileRules ?? []).map((one): GrantOffer =>
      one.choice === "file"
        ? {
            decision: "allow-file",
            label: one.withoutBackup
              ? `Changes to ${one.label} without a backup`
              : `Changes to ${one.label}`,
            short: one.label,
            icon: "file",
          }
        : {
            decision: "allow-folder",
            label: `Changes to files in ${one.label}`,
            short: folderName(one.label),
            icon: "folder",
          },
    ),
    ...(rule
      ? [
          {
            decision: "allow-conversation" as const,
            label: rule.label,
            short: rule.label,
            icon:
              rule.scope === "destination"
                ? ("user" as const)
                : ("plug" as const),
          },
        ]
      : []),
  ];
}

/** A folder by its own name, as "notes\" for "D:\Shared\notes\". */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? `${parts.at(-1)}\\` : path;
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
              <strong>{visibleText(file.path)}</strong>
              {file.reason && <span>{visibleText(file.reason)}</span>}
            </li>
          ))}
      </ul>
    </div>
  );
}
