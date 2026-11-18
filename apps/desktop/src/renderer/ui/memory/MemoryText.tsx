import type { ReactNode } from "react";
import type { MemoryEntry } from "@zhiyin/contract";
import { textPieces } from "./memory.js";
import styles from "./memory.module.css";

/**
 * An entry's text as it reads in its file: paragraphs, and lines starting
 * with "- " as a list. A link to a kept entry opens it; one to an entry no
 * longer kept stays as its number.
 */
export function MemoryText({
  text,
  entries,
  onOpen,
}: {
  text: string;
  entries: readonly MemoryEntry[];
  onOpen: (number: number) => void;
}) {
  const kept = new Map(entries.map((entry) => [entry.number, entry]));
  const inline = (line: string): ReactNode[] =>
    textPieces(line).map((piece, at) => {
      if (piece.kind === "words") return piece.text;
      const target = kept.get(piece.number);
      return target ? (
        <button
          key={at}
          type="button"
          className={styles["memory-link"]}
          onClick={() => onOpen(piece.number)}
        >
          #{piece.number}
        </button>
      ) : (
        <span key={at} className={styles["memory-link--gone"]}>
          #{piece.number}
        </span>
      );
    });

  return (
    <div className={styles["memory-text"]}>
      {blocks(text).map((block, at) =>
        block.kind === "list" ? (
          <ul key={at}>
            {block.lines.map((line, item) => (
              <li key={item}>{inline(line)}</li>
            ))}
          </ul>
        ) : (
          <p key={at}>{inline(block.lines.join(" "))}</p>
        ),
      )}
    </div>
  );
}

type Block = { kind: "paragraph" | "list"; lines: string[] };

function blocks(text: string): Block[] {
  const found: Block[] = [];
  let current: Block | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      current = undefined;
      continue;
    }
    const kind = line.startsWith("- ") ? "list" : "paragraph";
    const words = kind === "list" ? line.slice(2) : line;
    if (current?.kind !== kind) {
      current = { kind, lines: [] };
      found.push(current);
    }
    current.lines.push(words);
  }
  return found;
}
