/**
 * How close two entries are, without a model (ADR 0026): the words they share,
 * each weighed by how rare it is across memory, the title counting most and
 * the text least. Chinese and Japanese, written without spaces, are read in
 * pairs of characters. Case and accents are ignored.
 */

type Written = {
  readonly title: string;
  readonly summary: string;
  readonly text: string;
};

const ideographic = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u;

/** A text's words, folded, with runs of ideographs as pairs. */
function wordsOf(text: string): string[] {
  const folded = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const words: string[] = [];
  for (const run of folded.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (ideographic.test(run)) {
      const characters = [...run];
      if (characters.length === 1) words.push(run);
      for (let index = 0; index < characters.length - 1; index += 1)
        words.push(characters[index]! + characters[index + 1]!);
    } else if (run.length > 1) words.push(run);
  }
  return words;
}

/** How often each word appears, the title's three times and the summary's twice. */
function counts(entry: Written): Map<string, number> {
  const found = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const word of wordsOf(text))
      found.set(word, (found.get(word) ?? 0) + weight);
  };
  add(entry.title, 3);
  add(entry.summary, 2);
  add(entry.text, 1);
  return found;
}

type Vector = ReadonlyMap<string, number>;

function cosine(one: Vector, other: Vector): number {
  let dot = 0;
  let oneSize = 0;
  let otherSize = 0;
  for (const [word, weight] of one) {
    oneSize += weight * weight;
    dot += weight * (other.get(word) ?? 0);
  }
  for (const weight of other.values()) otherSize += weight * weight;
  return oneSize && otherSize ? dot / Math.sqrt(oneSize * otherSize) : 0;
}

/** Closeness to each of a set of entries, weighed across that set. */
export class Closeness<Entry extends Written> {
  readonly #entries: readonly { entry: Entry; counts: Map<string, number> }[];
  readonly #rarity: (word: string) => number;
  readonly #vectors = new Map<Entry, Vector>();

  constructor(entries: readonly Entry[]) {
    this.#entries = entries.map((entry) => ({ entry, counts: counts(entry) }));
    const holding = new Map<string, number>();
    for (const { counts: words } of this.#entries)
      for (const word of words.keys())
        holding.set(word, (holding.get(word) ?? 0) + 1);
    const total = this.#entries.length;
    this.#rarity = (word) =>
      Math.log((total + 1) / ((holding.get(word) ?? 0) + 1)) + 1;
  }

  #vector(words: Map<string, number>): Vector {
    const vector = new Map<string, number>();
    for (const [word, count] of words)
      vector.set(word, (1 + Math.log(count)) * this.#rarity(word));
    return vector;
  }

  #of(entry: Entry): Vector {
    let vector = this.#vectors.get(entry);
    if (!vector) {
      const found = this.#entries.find((one) => one.entry === entry);
      vector = this.#vector(found?.counts ?? counts(entry));
      this.#vectors.set(entry, vector);
    }
    return vector;
  }

  /** The entries closest to `target`, at least `least` close, closest first. */
  closestTo(
    target: Entry,
    { least, most }: { readonly least: number; readonly most: number },
  ): Entry[] {
    const vector = this.#of(target);
    return this.#ranked(vector, (entry) => entry !== target, least, most);
  }

  /** The entries a search's words find, the closest first, with how close each is. */
  found(
    words: string,
    most: number,
  ): { readonly entry: Entry; readonly score: number }[] {
    const vector = this.#vector(
      counts({ title: "", summary: "", text: words }),
    );
    return this.#scored(vector, () => true, Number.MIN_VALUE, most);
  }

  #ranked(
    vector: Vector,
    keep: (entry: Entry) => boolean,
    least: number,
    most: number,
  ): Entry[] {
    return this.#scored(vector, keep, least, most).map(({ entry }) => entry);
  }

  #scored(
    vector: Vector,
    keep: (entry: Entry) => boolean,
    least: number,
    most: number,
  ): { readonly entry: Entry; readonly score: number }[] {
    return this.#entries
      .filter(({ entry }) => keep(entry))
      .map(({ entry }) => ({ entry, score: cosine(vector, this.#of(entry)) }))
      .filter(({ score }) => score >= least)
      .sort((one, other) => other.score - one.score)
      .slice(0, most);
  }
}
