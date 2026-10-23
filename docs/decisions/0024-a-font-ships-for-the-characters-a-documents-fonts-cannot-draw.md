# 0024. A font ships for the Chinese, Japanese and Korean characters a document's fonts cannot draw

Status: accepted

## Decision

- **Zhiyin ships Noto Sans CJK SC 2.004**, the Simplified Chinese face of the
  Noto CJK fonts, unmodified. It is fetched at build time from a pinned commit
  of the font's repository, kept only if its SHA-256 matches the one the app
  lists, and packed in the app's archive with the rest of the app, where the
  archive's integrity check covers it. Its licence, the SIL Open Font License,
  ships beside it.
- **The drawing process falls back on it for PDF text.** It is named last in
  every font set on the canvas, so it draws only the characters the fonts
  before it lack. Chinese, Japanese and Korean text in a font a PDF names
  without embedding is drawn with it; Latin text keeps its own font.
- **SVG text in those scripts is drawn with it too.** Before an SVG picture is
  decoded, each run of Chinese, Japanese or Korean characters inside its text
  is wrapped in a `tspan` that names the fallback font. Characters written as
  references, such as `&#20013;`, count as the characters they stand for.
  Latin text keeps the family the file gives it, and the run keeps every other
  property it inherits: size, weight, colour, position. The rewrite happens
  only in the contained drawing process (ADR 0023), only once the fallback
  font is installed there, and changes nothing outside `text` elements.
- **The generic families stand for fonts every Windows has**: sans-serif for
  Arial, serif for Times New Roman, monospace for Courier New.
- pdf.js reads no font from the machine. Text in a font a document names
  without embedding is drawn by the canvas, in an installed font of that name
  where there is one.

## Why

pdf.js ships the standard fonts and the character maps for Chinese, Japanese
and Korean, but no glyphs for those scripts. A document that names such a font
without embedding it has its text read correctly and drawn as a hollow box for
each character. The person chose to bundle a font so that this never depends
on the machine.

pdf.js draws text whose font it lacks with the canvas's `fillText`, in the
family `"<name>", <generic>`. Measured on 2026-10-19 with @napi-rs/canvas
1.0.8 on Windows 11: the canvas resolves no generic family, so `serif`,
`sans-serif` and `monospace` all drew in the first installed family it lists,
Agency FB on a machine with Office, a condensed display face. That applies to
Latin text too: any font a document names without embedding, and the machine
lacks, is drawn in it. Along a family list the canvas picks a font per
character, so naming the fallback font last draws only the characters the
others lack. Replacing the generic families with it instead would draw Latin
text in the fallback font.

The canvas decodes an SVG with Skia's SVG renderer, which draws a text run in
the first of its families it finds, with no fallback per character. Measured
on 2026-10-20 with `@napi-rs/canvas` 1.0.8: in Arial, Chinese text drew 4 dark
pixels where the fallback font drew 807; listing the fallback after Arial
changed nothing, and naming it first drew the whole line, Latin included, in
the fallback's shapes. A `tspan` naming the fallback around the Chinese run
alone drew both: the Chinese in the fallback, the Latin in Arial.

The full Simplified Chinese face maps 44,810 code points, Han, kana and Hangul
among them, so one file covers all three scripts. It is 16.4 MB, about
10.7 MB compressed with xz at its highest setting.

## Rejected

- **The machine's own Chinese, Japanese and Korean fonts**: drawing would
  depend on which fonts each machine has, which the person chose to avoid.
- **The Simplified Chinese region subset** (8.3 MB): it holds one region's
  characters, and its variable form maps no Hangul, so Korean text would still
  draw as boxes.
- **The collection of all five regional faces** (19.5 MB): the other four
  faces draw the same characters in other regions' shapes, which would be used
  only if a face were chosen for each document font.
- **Registering the font under the generic family names**: Latin text in a
  font the machine lacks would be drawn in the fallback font's Latin glyphs.
- **Naming the fallback first for every SVG `text` element**: simpler, but it
  draws the Latin text of every SVG in the fallback font's shapes.
- **Drawing SVG pictures in the window**, where Chromium falls back per
  character: it would move the decoding of a file out of the contained
  process (ADR 0023).

## Assumptions

- Arial, Times New Roman and Courier New are on every Windows Zhiyin runs on
  (ADR 0001).
- pdf.js draws text in a font it lacks through the canvas's `fillText` with a
  family list, and loads the same canvas module the app loads. An upgrade of
  either library that changes this is caught by the drawing tests.
- Simplified Chinese glyph shapes are acceptable for Japanese, Korean and
  Traditional Chinese text whose own font is missing.
- Characters of the Han, Hiragana, Katakana and Hangul scripts, CJK
  punctuation and the full-width forms are what the fallback font is for in an
  SVG; a character outside them that the file's font lacks still draws blank.
- A family an SVG names that itself has those characters, such as Microsoft
  YaHei, is overridden for them by the fallback font. The shapes differ; the
  text reads.
