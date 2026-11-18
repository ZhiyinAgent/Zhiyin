/**
 * Ranking catalog entries for a query: first the entries the query names,
 * then by BM25 over their title, other names, summary and further terms, each field's
 * matches weighted by how much it says.
 */

import type { CatalogEntry, CatalogEntryKind } from "@zhiyin/contract";
import { wordsOf } from "./words.js";

const k1 = 1.2;
const b = 0.75;
/** A word in the title or another name counts most, one in the further terms least. */
const weights = { title: 3, summary: 2, terms: 1 } as const;
const defaultLimit = 5;

export type CatalogMatch = {
  readonly entry: CatalogEntry;
  readonly score: number;
};

export type CatalogSearch = {
  readonly kind?: CatalogEntryKind;
  /** The most entries returned; five unless given. */
  readonly limit?: number;
};

export interface CatalogIndex {
  find(query: string, search?: CatalogSearch): readonly CatalogMatch[];
}

type Indexed = {
  readonly entry: CatalogEntry;
  /** Each word's weighted count across the fields. */
  readonly counts: ReadonlyMap<string, number>;
  readonly length: number;
  /** What the entry is called: its title, and its own name in its id and title. */
  readonly names: ReadonlySet<string>;
};

const lastOf = (text: string, separator: string) =>
  text.slice(text.lastIndexOf(separator) + 1);

function namesOf(entry: CatalogEntry): ReadonlySet<string> {
  const own = lastOf(entry.id, "/");
  return new Set([
    entry.title,
    lastOf(entry.title, "."),
    own,
    lastOf(own, "."),
  ]);
}

/**
 * How directly an entry is named by the query, 0 the most: named exactly,
 * named in another case, the owner of the member a dotted query names, or
 * none of these. A query that names an entry wants that entry before any
 * that only share its words, as `Edge` wants the class before `edges`.
 */
function naming(document: Indexed, query: string): number {
  if (document.names.has(query)) return 0;
  const folded = query.toLowerCase();
  for (const name of document.names)
    if (name.toLowerCase() === folded) return 1;
  const dot = query.lastIndexOf(".");
  if (dot > 0 && document.names.has(query.slice(0, dot))) return 2;
  return 3;
}

function indexed(entry: CatalogEntry): Indexed {
  const counts = new Map<string, number>();
  let length = 0;
  const fields: readonly (readonly [string, number])[] = [
    [entry.title, weights.title],
    [(entry.aliases ?? []).join(" "), weights.title],
    [entry.summary, weights.summary],
    [(entry.terms ?? []).join(" "), weights.terms],
  ];
  for (const [text, weight] of fields)
    for (const word of wordsOf(text)) {
      counts.set(word, (counts.get(word) ?? 0) + weight);
      length += weight;
    }
  return { entry, counts, length, names: namesOf(entry) };
}

export function catalogIndex(entries: readonly CatalogEntry[]): CatalogIndex {
  const documents = entries.map(indexed);
  const holding = new Map<string, number>();
  for (const document of documents)
    for (const word of document.counts.keys())
      holding.set(word, (holding.get(word) ?? 0) + 1);
  const total = documents.length;
  const averageLength =
    documents.reduce((sum, document) => sum + document.length, 0) / total || 1;
  const rarity = (word: string): number => {
    const held = holding.get(word) ?? 0;
    return Math.log(1 + (total - held + 0.5) / (held + 0.5));
  };
  return {
    find(query, { kind, limit = defaultLimit } = {}) {
      const words = [...new Set(wordsOf(query))].filter((word) =>
        holding.has(word),
      );
      if (!words.length) return [];
      const asked = query.trim();
      const matches: (CatalogMatch & { readonly naming: number })[] = [];
      for (const document of documents) {
        if (kind && document.entry.kind !== kind) continue;
        let score = 0;
        const norm = k1 * (1 - b + (b * document.length) / averageLength);
        for (const word of words) {
          const count = document.counts.get(word);
          if (count)
            score += (rarity(word) * count * (k1 + 1)) / (count + norm);
        }
        if (score > 0)
          matches.push({
            entry: document.entry,
            score,
            naming: naming(document, asked),
          });
      }
      // Sorting is stable, so equal scores keep the catalog's order.
      return matches
        .sort((a, c) => a.naming - c.naming || c.score - a.score)
        .slice(0, limit)
        .map(({ entry, score }) => ({ entry, score }));
    },
  };
}
