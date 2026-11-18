# 0019. Documents are read and drawn in a contained process

Status: accepted

## Decision

### The contained process

- **Zhiyin reads PDFs and pictures.** `read_document` refuses Word, Excel and
  PowerPoint files, saying which kind of file it is; Windows' own app can still
  be offered to open one, as for any document, picture or video, never for
  anything Windows could run.
- **Parsing happens in a contained process.** Pages the person sees are drawn
  in an Electron utility process, one per conversation showing a document.
  PDFs the model reads, a PDF the document compiler made read back, and
  pictures made smaller for the model are handled in shared processes of the
  same kind. Each process is put in a Job Object with a memory limit before it
  is given anything (ADR 0005). A page that takes longer than ten seconds ends
  its process wherever it is stuck, and the next request starts a new one.
  Inside the process, pdf.js runs on a Node worker thread, where it takes its
  Node code paths.
- **A drawing process ends once it has been asked nothing for a minute**,
  counted from the answer to its last request. A request still being worked
  on keeps it. The rule is the drawing host's, so the panel's processes and
  the shared reading process end the same way.
- **The documents stay in the core.** The next request starts a process, which
  is given the document again before it is asked for a page. What the panel
  shows and the pages already drawn for it do not change. Letting go of a
  document starts no process and keeps none running: a process that is not
  running holds no document, the next one is never given a document let go
  of, and letting go is not a request in the minute's count.
- **A process that cannot be started answers its request** as one that could
  not be contained: the panel says no contained process could draw the
  document, and the model's PDF read says the process could not be started.
  The next request tries again.
- **pdf.js runs with no system fonts, no embedded font faces and a cap on the
  size of images it decodes**, in a version that has no way to evaluate what a
  document contains. An SVG is sized before it is decoded and reaches nothing
  it refers to.
- **Only pictures and text leave the process.** A document goes in as bytes; a
  page comes back as an image and its size, or as its text. The window shows
  the drawn page as an image (ADR 0003). No document, font, script, link, form
  or embedded file is loaded by Electron or by the window.
- **A video is the one file the window plays, and only one the 3D studio
  rendered**, from a copy taken when it was written. The window is given that
  kept copy and nothing else: a request for another address, another
  conversation's video, or one let go of finds nothing. A video the studio did
  not render, or a file at that path that changed since, is not played.
- **Only the conversation's workspace is drawn.** A path outside it, directly
  or through a link, is refused before it is read. Files over 100 MiB and PDFs
  over 2,000 pages are not drawn. Every failure shows a sentence saying why in
  place of the pages.

### Showing and citing

- **Reading a document shows it.** When the main agent reads a workspace
  document with `read_document`, it is shown in a panel beside the
  conversation at the first page read, and the read's answer tells the agent
  what the person now sees. A document Zhiyin writes opens that panel the
  first time. How long a person's choice of what the panel shows holds is
  decided with the rest of the space beside a conversation (ADR 0021).
  Specialists' reads show nothing (ADR 0011).
- **The agent can give the space back** with `close_document`, which closes
  the panel and tells the agent what the person sees then. Specialists, which
  have no space beside the conversation, are not offered it.
- **The agent cites a page as a link** to the document's workspace path ending
  in `#page=N`; each read gives it the exact link. Clicking one asks the core
  to show that page, which refuses a path outside the workspace or a page the
  document does not have.

### A font for Chinese, Japanese and Korean

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
  only in the contained drawing process, only once the fallback font is
  installed there, and changes nothing outside `text` elements.
- **The generic families stand for fonts every Windows has**: sans-serif for
  Arial, serif for Times New Roman, monospace for Courier New.
- pdf.js reads no font from the machine. Text in a font a document names
  without embedding is drawn by the canvas, in an installed font of that name
  where there is one.

## Why

A document can come from anywhere: a download, an attachment, a folder the
person chose. pdf.js has had flaws that let a crafted PDF run script, and its
canvas draws in native code, where a fault ends the process it runs in. A
worker thread's memory limit covers the JavaScript heap, not the buffers pdf.js
decodes images into, and `terminate()` cannot interrupt a native call that
never returns. Inside the core, either failure would end every running
conversation; in a contained process, it costs a page.

A process kept for every conversation that has shown a document holds memory
for pages nobody is looking at: measured on 2026-10-19 with Electron 44.1.1 on
Windows 11, a utility process running the built drawing script held 119 to
132 MB of working set (134 to 147 MB private) after drawing one page of a
small PDF, so ten such conversations hold more than a gigabyte. Starting again
costs little. In the same measurement, six runs on a one-page, 26 KB PDF, a
new process took 283 to 325 ms from start to the first page drawn, against 87
to 106 ms for a page drawn by a process already running: about 200 ms more,
for loading pdf.js and opening the document again. Pages already drawn for the
shown document come from the core and cost nothing.

An idle end works only if nothing else starts a process. A document let go of
through the path a request takes would start a process just to forget it, and
with an idle end every document let go of would start one again. A start that
fails and is thrown to every caller rather than answered leaves the panel
opening forever and the model's PDF read failing with an internal error.

A video cannot be shown as pictures, so it is played in the window. Playing
only the 3D studio's own render, from a copy, keeps the window from decoding a
file that came from anywhere.

What the agent reads is what the person sees, so the person can check an
answer against the page it rests on, and the citation keeps that page one
click away after the conversation ends.

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
Latin text too. Along a family list the canvas picks a font per character, so
naming the fallback font last draws only the characters the others lack.

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

- Drawing in the window: a crafted file would run where the person's whole
  interface runs.
- Drawing on a worker thread in the core: its limits cover neither native
  memory nor native hangs.
- Running pdf.js on the utility process's main thread: it takes that process
  for a web page and reaches for a browser's canvas and font loading. Telling
  it otherwise would mean misreporting the process type to Electron's own
  code.
- A plain Node child process: the packaged executable does not run as Node
  (ADR 0001).
- Keeping a conversation's drawing process while its panel shows a document:
  conversations left hours before keep theirs.
- Ending the panel's processes with the rest of a conversation left alone
  (after 15 minutes, which ends its browser and Blender): processes of every
  conversation visited in the last quarter of an hour stay, the core would
  have to reach into the viewer's processes, and the reading process would
  keep a rule of its own. Its advantage, no restart in the conversation on
  screen, is worth about 200 ms on the first page not yet drawn after a minute
  of reading.
- Forgetting the documents with the process: the next page would be drawn
  from the file as it is then, which may no longer be the revision shown.
- A separate tool for showing a page: two tools for one file, and the model
  has to choose between them.
- Reading Office formats: left out by choice; a document saved as PDF is read.
- The machine's own Chinese, Japanese and Korean fonts: drawing would depend
  on which fonts each machine has.
- The Simplified Chinese region subset (8.3 MB): it holds one region's
  characters, and its variable form maps no Hangul, so Korean text would still
  draw as boxes.
- The collection of all five regional faces (19.5 MB): the other four faces
  draw the same characters in other regions' shapes, which would be used only
  if a face were chosen for each document font.
- Registering the font under the generic family names, or naming it first for
  every SVG `text` element: Latin text would be drawn in the fallback font's
  Latin glyphs.
- Drawing SVG pictures in the window, where Chromium falls back per character:
  it would move the decoding of a file out of the contained process.

## Assumptions

- A Job Object memory limit holds native allocations, and closing the Job
  Object ends a process stuck in native code.
- `process.type` is undefined on a worker thread inside a utility process.
  Electron does not document this; the drawing thread checks it and refuses to
  start otherwise.
- A page drawn as an image at the panel's width is sharp enough to read.
- One shared reading process is worth a read in flight failing when another
  document ends the process; the model reads again.
- Starting a process and opening a document again takes a fraction of a
  second. Measured for a small PDF; a large one takes longer to open, in
  proportion to what pdf.js parses.
- A document's bytes kept in the main process cost less than a process: at
  most 100 MB, the panel's limit, and usually far less.
- A minute tells a person reading a page from a conversation left alone.
  Someone who reads one page for longer waits once for the next page not yet
  drawn.
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
