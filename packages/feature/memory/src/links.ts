/**
 * Links between entries are written in their text as `#12`, where the reason
 * for them is (ADR 0026). Which entries link to one is worked out from the
 * files, so a link is written once and followed both ways.
 */

import type { MemoryEntry } from "@zhiyin/contract";

const link = /(?<![\w&])#(\d+)\b/g;

/** The numbers an entry's text links to, each once, in the order written. */
function linksOf(entry: Pick<MemoryEntry, "number" | "text">): number[] {
  const numbers = [...entry.text.matchAll(link)].map((found) =>
    Number(found[1]),
  );
  return [...new Set(numbers)].filter((number) => number !== entry.number);
}

type Titled = { readonly number: number; readonly title: string };

/** The kept entries an entry links to, by number and title. */
export function linkLines(
  entry: Pick<MemoryEntry, "number" | "text">,
  kept: readonly MemoryEntry[],
): Titled[] {
  return linksOf(entry).flatMap((number) => {
    const found = kept.find((one) => one.number === number);
    return found ? [{ number, title: found.title }] : [];
  });
}

/** The kept entries linking to `number`, by number and title. */
export function linkedFrom(
  number: number,
  kept: readonly MemoryEntry[],
): Titled[] {
  return kept
    .filter((one) => one.number !== number && linksOf(one).includes(number))
    .map((one) => ({ number: one.number, title: one.title }));
}
