import { Icon, visibleText } from "../../shared/index.js";
import styles from "./approvals.module.css";

export type ApprovalDecision =
  "allow-once" | "allow-conversation" | "allow-file" | "allow-folder" | "deny";

/** A grant for the rest of the conversation the request offers, as one button. */
export type GrantOffer = {
  readonly decision: Exclude<ApprovalDecision, "allow-once" | "deny">;
  /** What the grant covers, in full. */
  readonly label: string;
  /** The same in a word or two, for the button itself. */
  readonly short: string;
  readonly icon: Parameters<typeof Icon>[0]["name"];
};

/**
 * What the two answers say, and say while they are sent: Deny and Allow
 * once, unless the request's answer holds for the rest of the conversation.
 * `note` false leaves out denying with a note.
 */
export type AnswerWords = {
  readonly allow: string;
  readonly allowing: string;
  readonly deny: string;
  readonly denying: string;
  readonly note: boolean;
};

const askedOnce: AnswerWords = {
  allow: "Allow once",
  allowing: "Allowing…",
  deny: "Deny",
  denying: "Denying…",
  note: true,
};

/**
 * The decision, on one line: the grants for this conversation the request
 * offers, then Deny and Allow once. Every grant, a tool's, a destination's, a
 * file's or a folder's, is one button of the same kind, named by what it
 * covers, its whole coverage in its tip, and taken in one press; the person
 * takes it back under the conversation's Permissions. Deny acts at once; the
 * pencil beside it denies with a note. The prompt holds where the decision
 * stands; this draws it.
 */
export function ApprovalChoice({
  pending,
  denial,
  offers,
  words = askedOnce,
  onDecide,
}: {
  /** The decision being sent, which holds every control until it settles. */
  pending: ApprovalDecision | null;
  /** The note a denial may carry, and what the person wrote in it. */
  denial: {
    readonly open: boolean;
    readonly reason: string;
    readonly onOpen: () => void;
    readonly onBack: () => void;
    readonly onReason: (reason: string) => void;
  };
  offers: readonly GrantOffer[];
  words?: AnswerWords;
  onDecide: (decision: ApprovalDecision) => void;
}) {
  const busy = pending !== null;
  if (denial.open)
    return (
      <div className={styles["approval__deny-step"]}>
        <label className={styles["approval__denial-reason"]}>
          <span>What should Zhiyin do instead?</span>
          <textarea
            autoFocus
            value={denial.reason}
            onChange={(event) => denial.onReason(event.target.value)}
            maxLength={2_000}
            disabled={busy}
          />
        </label>
        <div className={styles.approval__actions}>
          <button
            className="button button--quiet"
            type="button"
            disabled={busy}
            onClick={denial.onBack}
          >
            Back
          </button>
          <button
            className="button button--accent"
            type="button"
            disabled={busy}
            onClick={() => onDecide("deny")}
          >
            {pending === "deny" ? "Denying…" : "Deny and send"}
          </button>
        </div>
      </div>
    );
  return (
    <div className={styles.decision}>
      {offers.length > 0 && (
        <div
          className={styles.decision__grants}
          role="group"
          aria-label="Allow for this conversation"
        >
          <span className={styles["decision__grants-label"]} aria-hidden="true">
            For this conversation
          </span>
          {offers.map((offer) => (
            <button
              key={offer.decision}
              className="button"
              type="button"
              aria-label={`Allow for this conversation: ${visibleText(offer.label)}`}
              data-tip={visibleText(offer.label)}
              disabled={busy}
              onClick={() => onDecide(offer.decision)}
            >
              <Icon name={offer.icon} />
              <span>
                {pending === offer.decision
                  ? "Allowing…"
                  : visibleText(offer.short)}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className={styles.decision__answer}>
        {words.note ? (
          <span className={styles.decision__deny}>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => onDecide("deny")}
            >
              {pending === "deny" ? words.denying : words.deny}
            </button>
            <button
              className="button"
              type="button"
              aria-label="Deny with a note"
              data-tip="Deny with a note"
              disabled={busy}
              onClick={denial.onOpen}
            >
              <Icon name="pencil" />
            </button>
          </span>
        ) : (
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => onDecide("deny")}
          >
            {pending === "deny" ? words.denying : words.deny}
          </button>
        )}
        <button
          className="button button--accent"
          type="button"
          disabled={busy}
          onClick={() => onDecide("allow-once")}
        >
          {pending === "allow-once" ? words.allowing : words.allow}
        </button>
      </div>
    </div>
  );
}
