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
 * Inputs read as words: a name written for code, such as `max_results`,
 * reads "Max results", and a list of names is a list, not a JSON array.
 * Drawn `raw`, under Technical details, every name and value is as sent.
 *
 * Inputs are kept whole however long. Where a call is being approved they are
 * drawn whole at once; elsewhere a very long one shows its start and opens to
 * the rest on request, so a record of a large write stays quick to open.
 */
export function ToolCallView({
  invocation,
  label,
  hideName = false,
  showVia = false,
  whole = false,
  raw = false,
}: {
  invocation: ToolInvocation;
  label?: string;
  /** Leave out the tool's own name, which is written for code. */
  hideName?: boolean;
  /** With the name left out, still say where the call went. */
  showVia?: boolean;
  /** Draw every input whole at once, as an approval must. */
  whole?: boolean;
  /** Names and values exactly as sent, for Technical details. */
  raw?: boolean;
}) {
  const via = !hideName || showVia ? invocation.via : undefined;
  return (
    <section
      className={`${styles["tool-call"]}${whole ? ` ${styles["tool-call--whole"]}` : ""}`}
      aria-label={label ?? "What was called"}
    >
      {(label || !hideName || via) && (
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
          {(!hideName || via) && (
            <div className={styles["tool-call__identity"]}>
              {!hideName && <code>{visibleText(invocation.name)}</code>}
              {via && (
                <span
                  className={styles["tool-call__via"]}
                  title={visibleText(via)}
                >
                  {visibleText(via)}
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
          {/* A connection reached at an address wrote its own descriptions;
              a built-in tool's are Zhiyin's. */}
          {invocation.via &&
            invocation.arguments.some((argument) => argument.described) && (
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
                className={
                  argument.readable ? styles["tool-call__words"] : undefined
                }
              >
                <dt>
                  {visibleText(raw ? argument.name : inputName(argument.name))}
                </dt>
                <dd>
                  {argument.described && (
                    <p
                      className={styles["tool-call__described"]}
                      data-claim={invocation.via ? "tool" : undefined}
                    >
                      {visibleText(argument.described)}
                    </p>
                  )}
                  {/* Written for a person already: read as text, not data. */}
                  {argument.readable ? (
                    <p>{visibleText(argument.value)}</p>
                  ) : !raw &&
                    argument.omitted === undefined &&
                    listOf(argument.value) ? (
                    <ValueList items={listOf(argument.value)!} />
                  ) : (
                    <ArgumentValue
                      text={argument.value}
                      whole={whole}
                      omitted={argument.omitted}
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
  omitted?: number | undefined;
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

/** Words that keep their capitals when a name written for code is read. */
const initialisms: Readonly<Record<string, string>> = {
  api: "API",
  css: "CSS",
  html: "HTML",
  id: "ID",
  ids: "IDs",
  json: "JSON",
  pdf: "PDF",
  sql: "SQL",
  uri: "URI",
  url: "URL",
  urls: "URLs",
};

/**
 * An input's name as words: one written for code, as `max_results` or
 * `includeIgnored` are, reads "Max results" and "Include ignored". A name
 * already in words is left as its tool wrote it.
 */
function inputName(name: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]*(?:[_-]+[A-Za-z0-9]+)*$/.test(name)) return name;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => initialisms[word.toLowerCase()] ?? word.toLowerCase());
  const [first = "", ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/**
 * The items of a value that is a list of plain values, such as paths or
 * packages, or nothing for any other value.
 */
function listOf(value: string): string[] | undefined {
  if (!value.trimStart().startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (item) =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      )
    )
      return parsed.map(String);
  } catch {
    return undefined;
  }
  return undefined;
}

function ValueList({ items }: { items: readonly string[] }) {
  return (
    <ul className={styles["tool-call__list"]}>
      {items.map((item, index) => (
        <li key={index}>{visibleText(item)}</li>
      ))}
    </ul>
  );
}
