import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  return (
    <div className={styles["message-prose"]}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children: tableChildren }) => (
            <div className={styles["message-table-scroll"]}>
              <table>{tableChildren}</table>
            </div>
          ),
          a: ({ children: linkChildren, href }) => {
            const target = readableLinkTarget(href);
            return target ? (
              <span className={styles["message-link"]} title={target}>
                {linkChildren}
                <span className={styles["message-link__target"]}>
                  {" "}
                  — {target}
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
