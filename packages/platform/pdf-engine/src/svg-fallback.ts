/**
 * The canvas decodes an SVG with Skia's SVG renderer, which draws a text run
 * in the first of its font families it finds and falls back on nothing: in
 * Arial, Chinese, Japanese and Korean characters come out blank. So before an
 * SVG is decoded, each run of those characters inside a `<text>` is wrapped in
 * a `<tspan>` that names the fallback font. Latin text keeps the family the
 * file gave it, and the run keeps everything else it inherits.
 */

import { fallbackFontFamily } from "./pdf-engine.js";

/** A character of the scripts the fallback font draws. */
const wide =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]$/u;

/** A text's characters, each a character reference or one code point. */
const tokens = /&#(?:\d+|[xX][0-9a-fA-F]+);|&\w+;|[\s\S]/gu;

/** The character a token stands for, as far as wide characters go. */
function characterOf(token: string): string {
  const reference = /^&#([xX]?)([0-9a-fA-F]+);$/.exec(token);
  if (!reference) return token;
  const code = Number.parseInt(reference[2]!, reference[1] ? 16 : 10);
  return code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

/** The text between two tags, each run of wide characters wrapped. */
function wrapped(text: string, family: string): string {
  let out = "";
  let run = "";
  /** Spaces after a run, which join it only if another wide character follows. */
  let gap = "";
  const close = () => {
    if (run) out += `<tspan font-family="${family}">${run}</tspan>`;
    out += gap;
    run = "";
    gap = "";
  };
  for (const [token] of text.matchAll(tokens)) {
    if (wide.test(characterOf(token))) {
      run += gap + token;
      gap = "";
    } else if (run && /^\s$/.test(token)) gap += token;
    else {
      close();
      out += token;
    }
  }
  close();
  return out;
}

/**
 * The SVG with each run of Chinese, Japanese or Korean text inside a `<text>`
 * drawn in the fallback font, once that font is installed; otherwise, or when
 * it has no such text, the SVG as it was.
 */
export function svgWithFallbackFont(svg: Buffer): Buffer {
  const family = fallbackFontFamily();
  if (!family) return svg;
  const source = svg.toString("utf8");
  let out = "";
  let inText = 0;
  let at = 0;
  let changed = false;
  while (at < source.length) {
    const open = source.indexOf("<", at);
    const text = source.slice(at, open < 0 ? source.length : open);
    if (inText > 0 && text) {
      const next = wrapped(text, family);
      changed ||= next !== text;
      out += next;
    } else out += text;
    if (open < 0) break;
    const end = tagEnd(source, open);
    const tag = source.slice(open, end);
    out += tag;
    if (/^<text[\s>/]/i.test(tag) && !tag.endsWith("/>")) inText += 1;
    else if (/^<\/text\s*>/i.test(tag)) inText = Math.max(0, inText - 1);
    at = end;
  }
  return changed ? Buffer.from(out, "utf8") : svg;
}

/**
 * Where the markup that starts at `open` ends: a comment, CDATA section or
 * processing instruction at its own close, a tag at its `>` outside quotes.
 */
function tagEnd(source: string, open: number): number {
  for (const [start, close] of [
    ["<!--", "-->"],
    ["<![CDATA[", "]]>"],
    ["<?", "?>"],
  ] as const)
    if (source.startsWith(start, open)) {
      const end = source.indexOf(close, open + start.length);
      return end < 0 ? source.length : end + close.length;
    }
  let quote: string | undefined;
  for (let at = open + 1; at < source.length; at += 1) {
    const character = source[at]!;
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return at + 1;
  }
  return source.length;
}
