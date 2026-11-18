/**
 * The difference between two versions of a file, by line, and by word inside
 * a line that was rewritten: what the tools, the window's change review and an
 * exported conversation all show. The text-diff package computes it.
 */

export type DiffLine = {
  readonly kind: "same" | "added" | "removed";
  /** 1-based line number in the version this line belongs to. */
  readonly beforeLine?: number;
  readonly afterLine?: number;
  readonly text: string;
  /** The line in pieces, those that differ from the line it pairs with marked. */
  readonly parts?: readonly DiffLinePart[];
};

export type DiffLinePart = { readonly text: string; readonly changed: boolean };

export type DiffSection =
  | { readonly kind: "lines"; readonly lines: readonly DiffLine[] }
  /** A run of unchanged lines that was left out, and how many. */
  | { readonly kind: "skipped"; readonly count: number };

export type DiffSummary = {
  readonly added: number;
  readonly removed: number;
  readonly sections: readonly DiffSection[];
};
