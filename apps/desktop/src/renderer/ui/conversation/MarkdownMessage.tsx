import { Fragment, memo, useContext, useMemo, type ReactNode } from "react";
import ReactMarkdown, {
  type Components,
  type ExtraProps,
  type Options,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  documentCitation,
  OpenCitation,
  OpenLink,
  type DocumentCitation,
} from "./citation.js";
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

/** A part of the markdown read, as react-markdown hands it to a component. */
type ReadElement = NonNullable<ExtraProps["node"]>;
type ReadContent = ReadElement["children"][number];

function holdsPicture(node: ReadContent): boolean {
  return (
    node.type === "element" &&
    (node.tagName === "img" || node.children.some(holdsPicture))
  );
}

/** What a part says, a picture by its words. */
function wordsOf(node: ReadContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  if (node.tagName === "img") return String(node.properties["alt"] ?? "");
  return node.children.map(wordsOf).join("");
}

/** How an answer's markdown is drawn, with what a cited page opens in. */
function useMarkdownParts(): Components {
  const open = useContext(OpenCitation);
  const openLink = useContext(OpenLink);
  return useMemo(() => {
    /** A cited workspace document, as a button that opens it beside the conversation. */
    const cited = (
      citation: DocumentCitation,
      words: ReactNode,
      opener: NonNullable<typeof open>,
    ) => {
      const name = citation.path.split(/[\\/]/).at(-1) ?? citation.path;
      const opens = `opens ${name}${citation.page ? ` at page ${citation.page}` : ""}`;
      return (
        <button
          className={styles["message-citation"]}
          type="button"
          title={opens.replace(/^o/, "O")}
          onClick={() => opener(citation.path, citation.page)}
        >
          {words || name}
          <span className={styles["message-citation__opens"]}>, {opens}</span>
        </button>
      );
    };
    const parts: Components = {
      // The address of a picture in an answer is the model's choice, and
      // drawing it would have the window fetch whatever it names: a file on
      // this computer or a network share as readily as a web page. The
      // answer keeps the picture's words; pictures reach the window only
      // as data Zhiyin read itself. A picture in the workspace is cited, as
      // a link to it would be, and opens beside the conversation.
      img: ({ alt, src }) => {
        const citation = documentCitation(
          typeof src === "string" ? src : undefined,
        );
        if (citation && open) return cited(citation, alt, open);
        return alt ? <span>{alt}</span> : null;
      },
      table: ({ children: tableChildren }) => (
        <div className={styles["message-table-scroll"]}>
          <table>{tableChildren}</table>
        </div>
      ),
      a: ({ children, href, node }) => {
        // A picture inside a link is its words there: one control, never a
        // citation inside a link.
        const linkChildren =
          node && holdsPicture(node) ? wordsOf(node) : children;
        // A document page the agent cited opens beside the conversation
        // (ADR 0019); without anything to open it, it is its words alone.
        const citation = documentCitation(href);
        if (citation && open) return cited(citation, linkChildren, open);
        const target = readableLinkTarget(href);
        if (!target || !href) return <span>{linkChildren}</span>;
        // A link whose words are its address is given once. Compared with
        // the address as the answer wrote it: a host outside ASCII reads
        // differently once made a URL.
        const words = typeof linkChildren === "string" ? linkChildren : "";
        const said =
          bareAddress(words) === bareAddress(href) ? (
            linkChildren
          ) : (
            <>
              {linkChildren}
              {/* The site the browser will reach, as it will reach it: a
                  name written to look like another's reads as what it is. */}
              <span className={styles["message-link__site"]}>
                {" · "}
                {new URL(target).hostname.replace(/^www\./, "")}
              </span>
            </>
          );
        return openLink ? (
          <a
            className={styles["message-link"]}
            href={target}
            title={target}
            onClick={(event) => {
              event.preventDefault();
              openLink(target);
            }}
            onAuxClick={(event) => event.preventDefault()}
          >
            {said}
          </a>
        ) : (
          <span title={target}>{said}</span>
        );
      },
    };
    return parts;
  }, [open, openLink]);
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
