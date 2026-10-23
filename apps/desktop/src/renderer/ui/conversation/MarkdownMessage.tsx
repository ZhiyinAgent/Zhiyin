import { Fragment, memo, useContext, useMemo } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
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
 * An address as a person reads it: its escapes read back, as in 知音 or
 * bücher.de, with no scheme, no leading www. and no closing slash.
 */
function bareAddress(address: string): string {
  let read = address;
  try {
    read = decodeURI(address);
  } catch {
    // An escape that is not one: compared as written.
  }
  return read
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/** How an answer's markdown is drawn, with what a cited page opens in. */
function useMarkdownParts(): Components {
  const open = useContext(OpenCitation);
  return useMemo(
    () => ({
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
        // (ADR 0023); without anything to open it, it is its words alone.
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
        // A link whose words are its address is given once.
        const words = typeof linkChildren === "string" ? linkChildren : "";
        // Compared with the address as the answer wrote it: a host outside
        // ASCII reads differently once made a URL.
        if (target && href && bareAddress(words) === bareAddress(href))
          return (
            <span className={styles["message-link"]} title={target}>
              {linkChildren}
            </span>
          );
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
    }),
    [open],
  );
}

const remarkPlugins = [remarkGfm];

/** Where each top-level block of the markdown read starts, in characters. */
export type BlockStarts = (read: {
  /** Where the line of each top-level block starts, in characters. */
  readonly starts: readonly number[];
  /**
   * For each block, whether it reads the same with nothing before it, because
   * the block before it leaves nothing open behind it.
   */
  readonly readsAlone: readonly boolean[];
  /** Whether it defines a link or a note, which reaches the whole answer. */
  readonly defines: boolean;
}) => void;

type ReadNode = {
  readonly type: string;
  readonly position?: { readonly start: { readonly offset?: number } };
  readonly children?: readonly ReadNode[];
};

function defines(node: ReadNode): boolean {
  return (
    node.type === "definition" ||
    node.type === "footnoteDefinition" ||
    (node.children ?? []).some(defines)
  );
}

/**
 * Blocks after which reading starts afresh. After a list or an indented code
 * block it does not: the list's indentation still takes part of a tab on the
 * lines after it, and after indented code a line such as "10." is a paragraph
 * where alone it starts a list. HTML is left out with them.
 */
const closedBlocks = new Set([
  "paragraph",
  "heading",
  "thematicBreak",
  "table",
  "blockquote",
]);

/**
 * Tells, as markdown is read, where its top-level blocks start, which of them
 * read the same with nothing before them, and whether it defines a link or a
 * note.
 */
function remarkBlockStarts(report: BlockStarts) {
  return (tree: ReadNode, file: { readonly value: unknown }) => {
    const text = String(file.value);
    const blocks = tree.children ?? [];
    // A block's position starts after its indentation; its line, before it.
    const starts = blocks.map(
      (node) =>
        text.lastIndexOf("\n", (node.position?.start.offset ?? 0) - 1) + 1,
    );
    const closed = blocks.map(
      (node, index) =>
        closedBlocks.has(node.type) ||
        // Fenced code, which its closing line ends.
        (node.type === "code" &&
          /^ {0,3}(`{3}|~{3})/.test(text.slice(starts[index]))),
    );
    report({
      starts,
      readsAlone: blocks.map((_, index) => index > 0 && closed[index - 1]!),
      defines: defines(tree),
    });
  };
}

/** Markdown drawn as the answer draws it, read again only when it changes. */
const MarkdownPart = memo(function MarkdownPart({
  text,
  parts,
  onBlocks,
}: {
  text: string;
  parts: Components;
  /** Told where the blocks of this text start, each time it is read. */
  onBlocks?: BlockStarts | undefined;
}) {
  const plugins = useMemo<Options["remarkPlugins"]>(
    () =>
      onBlocks
        ? [...remarkPlugins, [remarkBlockStarts, onBlocks]]
        : remarkPlugins,
    [onBlocks],
  );
  return (
    <ReactMarkdown skipHtml remarkPlugins={plugins} components={parts}>
      {text}
    </ReactMarkdown>
  );
});

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
  const parts = useMarkdownParts();
  return (
    <div className={styles["message-prose"]}>
      <MarkdownPart text={children} parts={parts} />
    </div>
  );
});

/**
 * Markdown as top-level blocks that read the same apart as together, and what
 * is still growing after them: a finished block is read once, and only the
 * rest is read again when it changes. Drawn into the one element the whole
 * answer is, so it looks as the finished answer does.
 */
export function MarkdownBlocks({
  blocks,
  onLastBlocks,
}: {
  blocks: readonly string[];
  /** Told where the blocks of the last part start, each time it is read. */
  onLastBlocks?: BlockStarts;
}) {
  const parts = useMarkdownParts();
  return (
    <div className={styles["message-prose"]}>
      {blocks.map((block, index) => (
        <Fragment key={index}>
          {/* The line break the whole answer has between its blocks. */}
          {index > 0 && "\n"}
          <MarkdownPart
            text={block}
            parts={parts}
            onBlocks={index === blocks.length - 1 ? onLastBlocks : undefined}
          />
        </Fragment>
      ))}
    </div>
  );
}
