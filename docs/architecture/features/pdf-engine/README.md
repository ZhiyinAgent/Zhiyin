# PDF engine

## Purpose

Loads pdf.js and a canvas for it to draw on, and sets the options every PDF is
opened with. The model reads PDFs through the tools feature, and a person sees
them in the document viewer. Both must open a document the same way, and
neither may import the other, so this sits below them both.

## Boundaries

- **Owns:** loading pdf.js's Node build and the native canvas, installing the
  canvas's own drawing classes in place of pdf.js's, the fonts the canvas
  falls back on, and the options every document is opened with.
- **Does not own:** reading a PDF's text or choosing pages (tools), drawing
  pages for the panel (document viewer), which fallback font ships and where
  it is (the app), or any wording a person reads.
- **Talks to other features only through:** the functions below.

## Public interface

- `loadPdfjs()` returns pdf.js, loaded once.
- `loadCanvas(options)` returns the canvas, with its own `Path2D`, `DOMMatrix`
  and `ImageData` installed as globals before pdf.js draws. Given a
  `fallbackFont` file, the canvas draws with it the characters the fonts a
  page names cannot draw.
- `svgWithFallbackFont(svg)` returns an SVG whose Chinese, Japanese and
  Korean text is drawn with the fallback font, once it is installed.
- `pdfDocumentOptions(bytes)` returns the options a document is opened with.
- `textOfItem(item)` returns one item of a page's text, ending in a line break
  where the page ends a line, so the words on either side stay apart.

Both libraries load on first use, so a launch that opens no PDF does not pay
for them.

Text in a font that a document names without embedding, and that pdf.js does
not ship, is drawn by the canvas: in an installed font of the name the
document gives, where the machine has one, and otherwise in the generic family
pdf.js names after it. The fallback font reaches text drawn through the
canvas. The canvas's SVG renderer draws a text run in the first family it
finds, so an SVG's Chinese, Japanese and Korean runs are named in the
fallback font before it is decoded (ADR 0024).

- The types these take and return: `PdfViewport`, `PdfPage`, `PdfDocument`,
  `PdfLoadingTask`, `Pdfjs`, `CanvasContext`, `Canvas`, `CanvasModule`.

## Invariants

- Nothing in a document runs as code. The pdf.js build in use contains no
  `new Function` and no `eval`, in the main file or the worker, so there is no
  evaluation option to turn off (CVE-2024-4367 went through such a path).
- Opening a document reaches no network, and pdf.js reads no font from the
  machine. The document is opened from bytes in memory, without system fonts
  or font faces, using the standard fonts, image decoders and character maps
  that ship with pdf.js. pdf.js's script engine, which ships beside its image
  decoders, is loaded by neither its main file nor its worker.
- A scanned page draws its image, whether coded as CCITT fax, as office
  scanners write it, as JBIG2, or as JPEG 2000.
- Text in a Chinese, Japanese or Korean font that a document names without
  embedding, through one of the character maps pdf.js ships, is read, and
  drawn with the fallback font. That font comes last in every font set on the
  canvas, and the canvas picks a font per character, so it draws only what the
  fonts before it cannot: Latin text keeps its own font.
- The generic families pdf.js names stand for fonts every Windows has:
  sans-serif for Arial, serif for Times New Roman and monospace for Courier
  New. The canvas resolves none of them by itself, and would draw such text in
  whichever installed font it lists first.
- pdf.js skips any image larger than 64 million pixels instead of decoding it,
  and draws the rest of the page. That bound covers a full A4 page scanned at
  600 DPI.

## Testing notes

The pdf.js build is scanned for `new Function` and `eval`, so an upgrade that
brings either back fails the suite. Drawing and reading pages is tested where
it is used, in the tools feature and the document viewer, against real PDFs:
the document viewer's tests draw the scanned, JBIG2, JPEG 2000, Chinese and oversized
image pages above through its drawing service, the Chinese page with a test
font that draws 中, 文 and the Latin letters as solid squares. The installed app's tests draw a
Chinese page with the font the app ships.
