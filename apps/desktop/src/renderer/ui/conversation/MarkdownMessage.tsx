import { memo, useContext } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { documentCitation, OpenCitation } from "./citation.js";
import styles from "./conversation.module.css";

function readableLinkTarget(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Memoised on its text, which is the whole point.
 *
 * Every token of a streaming answer replaces the task and re-renders the
 * thread, and without this each of those re-parses the markdown of every
 * message already in it — quadratic work for text that has not changed since
 * the turn began.
 */
export const MarkdownMessage = memo(function MarkdownMessage({
  children,
}: {
  children: string;
}) {
  const open = useContext(OpenCitation);
  return (
    <div className={styles["message-prose"]}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          // The address of a picture in an answer is the model's choice, and
          // drawing it would have the window fetch whatever it names: a file on
          // this computer or a network share as readily as a web page. The
          // answer keeps the picture's words; pictures reach the window only
          // as data Zhiyin read itself.
          img: ({ alt }) => (alt ? <span>{alt}</span> : null),
          table: ({ children: tableChildren }) => (
            <div className={styles["message-table-scroll"]}>
              <table>{tableChildren}</table>
            </div>
          ),
          a: ({ children: linkChildren, href }) => {
            // A document page the agent cited opens beside the conversation
            // (ADR 0018); without anything to open it, it is its words alone.
            const citation = documentCitation(href);
            if (citation && open) {
              const name = citation.path.split(/[\\/]/).at(-1) ?? citation.path;
              const opens = `opens ${name}${citation.page ? ` at page ${citation.page}` : ""}`;
              return (
                <button
                  className={styles["message-citation"]}
                  type="button"
                  title={opens.replace(/^o/, "O")}
                  onClick={() => open(citation.path, citation.page)}
                >
                  {linkChildren}
                  <span className={styles["message-citation__opens"]}>
                    , {opens}
                  </span>
                </button>
              );
            }
            const target = readableLinkTarget(href);
            return target ? (
              <span className={styles["message-link"]} title={target}>
                {linkChildren}
                <span className={styles["message-link__target"]}>
                  {/* The dash stays with the address, never a line alone. */} —
                  {" "}
                  {target}
                </span>
              </span>
            ) : (
              <span>{linkChildren}</span>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
