/**
 * Characters that draw nothing, or that change the order the rest is drawn
 * in, so a text holding them can read as something it is not. Variation
 * selectors that only choose how an emoji looks are left alone.
 */
const hidden =
  /(?![\uFE0E\uFE0F])[\p{Bidi_Control}\p{Default_Ignorable_Code_Point}]/gu;

const joinsFrom = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]$/u;
const joinsTo = /^\p{Extended_Pictographic}/u;

/**
 * The text with each such character written as its code, `[U+202E]`, so what
 * a person approves reads as what will run. A joiner between two emoji stays:
 * it only draws them as one, as in a person at a computer.
 */
export function visibleText(text: string): string {
  return text.replace(hidden, (character: string, at: number) =>
    character === "\u200D" &&
    joinsFrom.test(text.slice(Math.max(0, at - 2), at)) &&
    joinsTo.test(text.slice(at + 1, at + 3))
      ? character
      : `[U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`,
  );
}
