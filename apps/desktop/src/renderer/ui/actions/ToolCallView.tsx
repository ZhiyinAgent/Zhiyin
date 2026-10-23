import { useState } from "react";
import type { ToolInvocation } from "@zhiyin/contract";
import { visibleText } from "../shared/index.js";
import { JsonBlock, looksStructured } from "./JsonBlock.js";
import styles from "./actions.module.css";

/**
 * What was called, and with what.
 *
 * One argument per row, rather than the call re-encoded as a line of JSON. A
 * person deciding whether to allow a search has to be able to see the query;
 * finding it inside `tool({"max_results":8,"query":"…","search_depth":"…"})`
 * is a decoding exercise, and decoding is not consent.
 *
 * Nothing here knows what any particular tool is. A tool that already renders
 * its own effects well — a shell command, a file change — is drawn by whatever
 * owns that rendering; this is what everything else falls back to, including
 * tools that do not exist yet.
 *
 * Inputs are kept whole however long. Where a call is being approved they are
 * drawn whole at once; elsewhere a very long one shows its start and opens to
 * the rest on request, so a record of a large write stays quick to open.
 */
export function ToolCallView({
  invocation,
  label,
  hideName = false,
  whole = false,
}: {
  invocation: ToolInvocation;
  label?: string;
  hideName?: boolean;
  /** Draw every input whole at once, as an approval must. */
  whole?: boolean;
}) {
  return (
    <section
      className={styles["tool-call"]}
      aria-label={label ?? "What was called"}
    >
      {(label || !hideName) && (
        <header
          className={styles["tool-call__header"]}
          role="group"
          aria-label="Tool"
        >
          {/*
            The caption belongs to the card it names. Keeping it inside the
            shared header prevents dialogs and permission prompts from each
            inventing their own spacing around the same tool call.
          */}
          {label && <span className={styles["tool-call__label"]}>{label}</span>}
          {!hideName && (
            <div className={styles["tool-call__identity"]}>
              <code>{visibleText(invocation.name)}</code>
              {invocation.via && (
                <span
                  className={styles["tool-call__via"]}
                  title={visibleText(invocation.via)}
                >
                  {visibleText(invocation.via)}
                </span>
              )}
            </div>
          )}
        </header>
      )}
      {invocation.arguments.length === 0 ? (
        <p className={styles["tool-call__none"]}>No inputs.</p>
      ) : (
        <>
          {invocation.arguments.some((argument) => argument.described) && (
            <p className={styles["tool-call__description-source"]}>
              Input descriptions come from the connected tool.
            </p>
          )}
          <dl className={styles["tool-call__arguments"]}>
            {/* Rows can share a name, such as two objects left unnamed, so
                each is known by its place. */}
            {invocation.arguments.map((argument, index) => (
              <div
                key={`${index}-${argument.name}`}
                {...(argument.readable
                  ? { className: styles["tool-call__words"] }
                  : {})}
              >
                <dt>{visibleText(argument.name)}</dt>
                <dd>
                  {argument.described && (
                    <p
                      className={styles["tool-call__described"]}
                      data-claim="tool"
                    >
                      {visibleText(argument.described)}
                    </p>
                  )}
                  {/* Written for a person already: read as text, not data. */}
                  {argument.readable ? (
                    <p>{visibleText(argument.value)}</p>
                  ) : (
                    <ArgumentValue
                      text={argument.value}
                      whole={whole}
                      {...(argument.omitted === undefined
                        ? {}
                        : { omitted: argument.omitted })}
                    />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

/** Longer than this, an input outside an approval opens on request. */
const foldedPast = 20_000;

/** What a folded input shows of its start. */
const shownWhenFolded = 2_000;

/**
 * A structure is laid out; anything else is left as the sentence, path or
 * query it is. Dressing a search term up as a coloured JSON string makes it
 * harder to read, not easier.
 *
 * A value cut from the middle no longer parses, so it is shown as it survived,
 * with the gap named where it falls.
 */
function ArgumentValue({
  text,
  omitted,
  whole,
}: {
  text: string;
  omitted?: number;
  whole: boolean;
}) {
  const [open, setOpen] = useState(whole);
  if (!open && text.length > foldedPast)
    return (
      <div className={styles["tool-call__folded"]}>
        <pre className={styles["tool-call__value"]}>
          {visibleText(text.slice(0, shownWhenFolded))}…
        </pre>
        <button
          type="button"
          className="text-button"
          onClick={() => setOpen(true)}
        >
          Show all {text.length.toLocaleString()} characters
        </button>
      </div>
    );
  if (omitted === undefined) {
    return looksStructured(text) ? (
      <JsonBlock
        text={text}
        className={styles["tool-call__value"]}
        shown={visibleText}
      />
    ) : (
      <pre className={styles["tool-call__value"]}>{visibleText(text)}</pre>
    );
  }
  const middle = Math.floor(text.length / 2);
  return (
    <pre className={styles["tool-call__value"]}>
      {visibleText(text.slice(0, middle))}
      <span className={styles["tool-call__omitted"]}>
        {` … ${omitted.toLocaleString()} characters hidden … `}
      </span>
      {visibleText(text.slice(middle))}
    </pre>
  );
}
