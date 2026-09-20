import type { ToolInvocation } from "@zhiyin/contract";
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
 */
export function ToolCallView({
  invocation,
  label,
  hideName = false,
}: {
  invocation: ToolInvocation;
  label?: string;
  hideName?: boolean;
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
              <code>{invocation.name}</code>
              {invocation.via && (
                <span
                  className={styles["tool-call__via"]}
                  title={invocation.via}
                >
                  {invocation.via}
                </span>
              )}
            </div>
          )}
        </header>
      )}
      {invocation.arguments.length === 0 ? (
        <p className={styles["tool-call__none"]}>No inputs.</p>
      ) : (
        <dl className={styles["tool-call__arguments"]}>
          {invocation.arguments.map((argument) => (
            <div key={argument.name}>
              <dt>{argument.name}</dt>
              <dd>
                {argument.described && (
                  /*
                    The tool's own words about its own input. Labelled with
                    where they came from for the same reason the model's claim
                    about an action is: a description nobody here checked must
                    not read as one this app stands behind.
                  */
                  <p
                    className={styles["tool-call__described"]}
                    data-claim="tool"
                  >
                    <span>What the tool says this is</span>
                    {argument.described}
                  </p>
                )}
                <ArgumentValue
                  text={argument.value}
                  {...(argument.omitted === undefined
                    ? {}
                    : { omitted: argument.omitted })}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/**
 * A structure is laid out; anything else is left as the sentence, path or
 * query it is. Dressing a search term up as a coloured JSON string makes it
 * harder to read, not easier.
 *
 * A value cut from the middle no longer parses, so it is shown as it survived,
 * with the gap named where it falls.
 */
function ArgumentValue({ text, omitted }: { text: string; omitted?: number }) {
  if (omitted === undefined) {
    return looksStructured(text) ? (
      <JsonBlock text={text} className={styles["tool-call__value"]} />
    ) : (
      <pre className={styles["tool-call__value"]}>{text}</pre>
    );
  }
  const middle = Math.floor(text.length / 2);
  return (
    <pre className={styles["tool-call__value"]}>
      {text.slice(0, middle)}
      <span className={styles["tool-call__omitted"]}>
        {` … ${omitted.toLocaleString()} characters hidden … `}
      </span>
      {text.slice(middle)}
    </pre>
  );
}
