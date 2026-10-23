# File kinds

## Purpose

What a file is, decided by its bytes. The agent's file tools and the document
panel both ask it: one decides whether `read_file` reads a file or sends it to
`read_document`, the other whether the panel draws it. Asked in two places, the
answers drifted apart, so the person could be shown a PDF the agent was told
is not one (ADR 0023 rests on the agent reading what the person sees). It is a
platform package so both features use one answer without importing each other.

## Boundaries

- **Owns:** the signatures of the kinds Zhiyin names, what a real file of each
  kind has after its signature, where a PDF's header may start, and the test
  that tells text from bytes that are not.
- **Does not own:** what a feature does with a kind: refusing, reading,
  drawing, or the limits on each. SVG is told apart by the document panel,
  since to these bytes it is text.
- **Talks to other features only through:** the functions below. It reads no
  file: the caller hands it the head.

## Public interface

- `fileKind(head)` is text, with its encoding where a byte-order mark names
  UTF-16, or binary, with what it is in words where the bytes say and the
  media type of a picture. It looks at the first 4 KB.
- `pdfDocument`, the name a PDF is given.
- The types `FileKind` and `TextEncoding`.

## Invariants

- **A short printable signature is not enough.** A bitmap needs its reserved
  bytes 6 to 9 at zero, a Windows program the zero bytes of its header, an
  MP3's tag a version from 2 to 4 and a zero revision, and a GIF its full
  `GIF87a` or `GIF89a` and a WebP `RIFF` before `WEBP`, each with bytes that
  are not text. Text that begins with such letters is text.
- **A PDF's header may follow a little before it,** as readers accept: within
  the first kilobyte, after nothing but blank space and a byte-order mark, or
  anywhere there when the file's head is not text. Text that mentions the
  header after other words is text.
- **Text is told by its bytes.** A NUL byte makes a file binary; more than one
  byte in ten a control character other than layout does too. Accented and
  non-Latin script is text. Text marked as UTF-16 is judged by its characters.
