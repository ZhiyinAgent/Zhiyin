import { useId, useState } from "react";
import type { CondensingFailure, TaskCondensing } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import styles from "./conversation.module.css";

const meaning: Record<CondensingFailure, (detail?: string) => string> = {
  "nothing-to-condense": () =>
    "there are no older messages to summarise yet; the most recent exchanges are always kept whole",
  "too-large": () => "it is larger than the model can read at once",
  "request-failed": (detail) =>
    `the request to the model failed${detail ? ` (${detail})` : ""}`,
  unusable: () => "the model's answer was not a usable summary",
};

const counted = (count: number, one: string) =>
  `${count} ${one}${count === 1 ? "" : "s"}`;

const tokens = (count: number) =>
  count < 1_000 ? `${count}` : `${Math.round(count / 1_000)}K`;

/**
 * Where the conversation was condensed, drawn where it happened. Closed, it
 * says in one plain line what happened; open, it gives the counts and how far
 * the request shrank, then the summary the model now works from as formatted
 * text, with the person's own words quoted, what Zhiyin carried over beside it
 * and the files it read again. A failed attempt is the same card, with the
 * reason on a quieter line under it.
 */
export function CondensingCard({ condensing }: { condensing: TaskCondensing }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const refused = condensing.afterRefusal
    ? ", after the provider said it was too long"
    : "";

  if (condensing.outcome === "failed")
    return (
      <div className={styles["condensing-card"]} role="status">
        <p className={styles["condensing-card__line"]}>
          Zhiyin could not compact the earlier conversation{refused}. It will
          try again later.
        </p>
        <p className={styles["condensing-card__why"]}>
          Why: {meaning[condensing.reason](condensing.detail)}.
        </p>
      </div>
    );

  return (
    <div className={styles["condensing-card"]}>
      <button
        type="button"
        className={styles["condensing-card__toggle"]}
        aria-expanded={open}
        aria-controls={open ? detailsId : undefined}
        onClick={() => setOpen(!open)}
      >
        <span>
          Zhiyin compacted the earlier conversation to make room{refused}
        </span>
        <span
          className={`${styles["condensing-card__chevron"]}${open ? ` ${styles["condensing-card__chevron--open"]}` : ""}`}
        >
          <Icon name="chevron" />
        </span>
      </button>
      {open && (
        <section
          id={detailsId}
          className={styles["condensing-card__details"]}
          aria-label="Earlier conversation compacted"
        >
          <p className={styles["condensing-card__counts"]}>
            {counted(condensing.messages, "message")} and{" "}
            {counted(condensing.actions, "action")} became the summary below:{" "}
            {tokens(condensing.tokensBefore)} → {tokens(condensing.tokensAfter)}{" "}
            tokens.
          </p>
          <MarkdownMessage>{condensing.summary}</MarkdownMessage>
          {condensing.carried && (
            <>
              <h3>Carried over by Zhiyin</h3>
              <MarkdownMessage>{condensing.carried}</MarkdownMessage>
            </>
          )}
          {condensing.reread?.length ? (
            <>
              <h3 id={`${detailsId}-files`}>Files read again</h3>
              <ul aria-labelledby={`${detailsId}-files`}>
                {condensing.reread.map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
