/**
 * Inexact name matching for the model list.
 *
 * A model is named two ways at once — a display name and a slug — and people
 * remember neither exactly. `son5` has to reach `anthropic/claude-sonnet-5`,
 * so matching is subsequence-based rather than substring-based, with the
 * ranking pushed toward matches that land on word starts and run consecutively.
 */

export type FuzzyMatch = {
  readonly score: number;
  /** Indices in the searched text that the query matched, in order. */
  readonly hits: readonly number[];
};

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const wanted = query.toLowerCase().replace(/\s+/g, "");
  if (!wanted) return { score: 0, hits: [] };
  const haystack = text.toLowerCase();
  const hits: number[] = [];
  let score = 0;
  let from = 0;
  let run = 0;

  for (const character of wanted) {
    const at = haystack.indexOf(character, from);
    if (at === -1) return null;
    const boundary = at === 0 || !/[a-z0-9]/.test(haystack[at - 1] ?? "");
    run = at === from && from !== 0 ? run + 1 : 0;
    score += 10 + run * 8 + (boundary ? 12 : 0) - Math.min(at - from, 8);
    hits.push(at);
    from = at + 1;
  }
  return { score, hits };
}

/** Splits text into the runs a match did and did not cover, for emphasis. */
export function fuzzySegments(
  text: string,
  hits: readonly number[],
): readonly { readonly text: string; readonly matched: boolean }[] {
  if (!hits.length) return [{ text, matched: false }];
  const segments: { text: string; matched: boolean }[] = [];
  let last = 0;
  for (const at of hits) {
    if (at > last)
      segments.push({ text: text.slice(last, at), matched: false });
    const previous = segments[segments.length - 1];
    if (previous?.matched) previous.text += text[at] ?? "";
    else segments.push({ text: text[at] ?? "", matched: true });
    last = at + 1;
  }
  if (last < text.length)
    segments.push({ text: text.slice(last), matched: false });
  return segments;
}
