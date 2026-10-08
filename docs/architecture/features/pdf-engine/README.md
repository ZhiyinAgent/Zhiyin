# PDF engine

## Purpose

Loads pdf.js and a canvas for it to draw on, and sets the options every PDF is
opened with. The model reads PDFs through the tools feature, and a person sees
them in the document viewer. Both must open a document the same way, and
neither may import the other, so this sits below them both.

## Boundaries

- **Owns:** loading pdf.js's Node build and the native canvas, installing the
  canvas's own drawing classes in place of pdf.js's, and the options every
  document is opened with.
- **Does not own:** reading a PDF's text or choosing pages (tools), drawing
  pages for the panel (document viewer), or any wording a person reads.
- **Talks to other features only through:** the functions below.

## Public interface

- `loadPdfjs()` returns pdf.js, loaded once.
- `loadCanvas()` returns the canvas, with its own `Path2D`, `DOMMatrix` and
  `ImageData` installed as globals before pdf.js draws.
- `pdfDocumentOptions(bytes)` returns the options a document is opened with.
- `textOfItem(item)` returns one item of a page's text, ending in a line break
  where the page ends a line, so the words on either side stay apart.

Both libraries load on first use, so a launch that opens no PDF does not pay
for them.

## Invariants

- Nothing in a document runs as code. The pdf.js build in use contains no
  `new Function` and no `eval`, in the main file or the worker, so there is no
  evaluation option to turn off (CVE-2024-4367 went through such a path).
- Opening a document reaches neither the network nor the machine's fonts. The
  document is opened from bytes in memory, without system fonts or font faces,
  using the standard fonts that ship with pdf.js.
- pdf.js skips any image larger than 64 million pixels instead of decoding it,
  and draws the rest of the page. That bound covers a full A4 page scanned at
  600 DPI.

## Testing notes

The pdf.js build is scanned for `new Function` and `eval`, so an upgrade that
brings either back fails the suite. Drawing and reading pages is tested where
it is used, in the tools feature and the document viewer, against real PDFs.
