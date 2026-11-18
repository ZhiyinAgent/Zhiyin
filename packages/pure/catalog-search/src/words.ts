/**
 * The words a search compares: names split into the words they are made of,
 * case folded, English plurals read as their singular, and Chinese text taken
 * by pairs of characters.
 */

const han = /(\p{Script=Han}+)/u;
const separators = /[^\p{L}\p{N}]+/u;
/** An upper-case run, a capitalised or lower-case word, a caseless letter run, or digits. */
const piece = /\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lo}+|\p{Lm}+|\p{N}+/gu;
const letter = /\p{L}/u;
const digit = /\p{N}/u;

function hanWords(run: string): readonly string[] {
  const characters = [...run];
  if (characters.length < 2) return characters;
  return characters.slice(1).map((second, at) => `${characters[at]}${second}`);
}

/**
 * An English plural as its singular, so `fcurve` finds `fcurves`, `mesh`
 * finds `meshes` and `property` finds `properties`. Words that only end in s, as `axis`, `class`
 * or `status`, stay whole.
 */
function singular(word: string): string {
  if (word.length < 4 || !/^[a-z]+$/.test(word)) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(sh|ch|x|z|ss)es$/.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word) || !word.endsWith("s")) return word;
  return word.slice(0, -1);
}

function latinWords(chunk: string): readonly string[] {
  const pieces = (chunk.match(piece) ?? []).map((part) =>
    singular(part.toLowerCase()),
  );
  // A name that mixes letters and digits, as `mp4` or `3d`, is also a word
  // whole, so a query that writes it whole ranks it above its parts.
  return letter.test(chunk) && digit.test(chunk) && pieces.length > 1
    ? [chunk.toLowerCase(), ...pieces]
    : pieces;
}

export function wordsOf(text: string): readonly string[] {
  return text
    .normalize("NFKC")
    .split(han)
    .flatMap((part, at) =>
      // Splitting by a captured group puts each Han run at an odd place.
      at % 2 === 1
        ? hanWords(part)
        : part
            .split(separators)
            .filter(Boolean)
            .flatMap((chunk) => latinWords(chunk)),
    );
}
