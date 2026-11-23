/**
 * Which matching lines a content search shows, grouped by file.
 *
 * ripgrep is not asked to sort: sorting makes it search one file at a time,
 * four times slower on 20,000 files. So lines are kept as they come, every
 * file's count is kept, and only the lines of the files first by path are
 * held once more than enough have come.
 */

import { byPath } from "@zhiyin/workspace-listing";

/** Matching lines shown; the count goes on past this. */
export const maximumMatches = 100;
/** Lines shown in all when context is asked for, matches included. */
export const maximumLines = 300;
export const maximumContext = 5;
const keptBeforeTrimming = 10 * maximumMatches;

export type FoundLine = {
  readonly line: number;
  readonly text: string;
  /** A line shown around a match, which did not match itself. */
  readonly context?: true;
};

type FileLines = { matching: number; lines: FoundLine[] };

export type ShownFile = {
  readonly path: string;
  readonly matching: number;
  readonly lines: readonly FoundLine[];
};

export class FoundLines {
  readonly #files = new Map<string, FileLines>();
  /** Files after the first by path that already hold enough to show. */
  readonly #beyond = new Set<string>();
  #held = 0;

  readonly context: number;

  constructor(context: number) {
    this.context = context;
  }

  add(path: string, line: FoundLine): void {
    let file = this.#files.get(path);
    if (!file) {
      file = { matching: 0, lines: [] };
      this.#files.set(path, file);
    }
    if (!line.context) file.matching += 1;
    if (this.#beyond.has(path)) return;
    file.lines.push(line);
    if (!line.context) this.#held += 1;
    if (this.#held > keptBeforeTrimming) this.#trim();
  }

  /** How many files had a matching line. */
  get inFiles(): number {
    return [...this.#files.values()].filter((file) => file.matching).length;
  }

  #trim(): void {
    let matches = 0;
    this.#held = 0;
    for (const path of this.#paths()) {
      const file = this.#files.get(path)!;
      if (matches >= maximumMatches) {
        file.lines = [];
        this.#beyond.add(path);
        continue;
      }
      matches += file.matching;
      this.#held += file.matching;
    }
  }

  #paths(): string[] {
    return [...this.#files.keys()].sort(byPath);
  }

  /**
   * The first matching lines by path and line, each with the context asked
   * for, within the bounds; files none of whose lines fit are left out.
   */
  shown(): { readonly files: ShownFile[]; readonly matches: number } {
    const files: ShownFile[] = [];
    let matches = 0;
    let lines = 0;
    for (const path of this.#paths()) {
      const file = this.#files.get(path)!;
      if (!file.matching) continue;
      const kept = [...file.lines].sort(
        (left, right) => left.line - right.line,
      );
      const chosen = new Map<number, FoundLine>();
      for (const match of kept) {
        if (match.context) continue;
        if (matches >= maximumMatches) break;
        const near = kept.filter(
          (line) =>
            Math.abs(line.line - match.line) <= this.context &&
            !chosen.has(line.line),
        );
        if (lines + near.length > maximumLines && matches > 0) break;
        for (const line of near) chosen.set(line.line, line);
        lines += near.length;
        matches += 1;
      }
      if (!chosen.size) break;
      files.push({
        path,
        matching: file.matching,
        lines: [...chosen.values()].sort(
          (left, right) => left.line - right.line,
        ),
      });
    }
    return { files, matches };
  }
}
