# Document viewer

## Purpose

Shows the PDF or picture a conversation is working on beside it, as pictures
of its pages. A document the agent writes appears as it is written and is
drawn again as it changes; the person can also open one, go to a page, and
switch between the conversation's documents. ADR 0023.

A document is untrusted, so it is never drawn in the app's own processes. The
file is read here and its bytes go to a contained drawing process, one per
conversation, ended after a minute without a request; only pictures of its
pages come back. PDFs the model reads are read in the same kind of process.
This is its own feature because that
lifecycle, with its limits and redraws as the file changes, belongs to
neither the tools, which read files for the model, nor the browser, which
shows live pages.

## Boundaries

- **Owns:** which document each conversation shows and its list of
  documents; reading that file inside the conversation's workspace; the
  limits on what is drawn; the drawing
  process, its time and memory limits, and the protocol to it; the pages drawn
  for the shown revision; how often a written document is drawn again; the
  sentences shown in place of pages; and the contained reading of PDFs, and
  shrinking of pictures, for the model.
- **Does not own:** where the panel sits or whether it is showing (core and
  renderer), its markup (renderer), which writes reach it (the core hears them
  from the agent loop and rewind), how a process is started (the application
  starts an Electron utility process), containment (process ownership and
  workspace containment), or loading pdf.js and the options a PDF opens with
  (PDF engine).
- **Talks to other features only through:** the interface below. It imports
  the contract and platform packages, never the tools or the browser.

## Public interface

- `new DocumentViewer({ start, containment, timeoutMs?, idleMs?, redrawIntervalMs? })`.
  Each call that reads a file is given the folder the conversation works in.
  - `show(conversation, folder, path, { page? })` shows a workspace document,
    at a page when one is named, and answers whether it did or why not.
  - `written(conversation, folder, paths)` hears that Zhiyin wrote these files
    and answers which were documents.
  - `refresh(conversation, folder)` draws the shown document again from disk,
    for a file Zhiyin put back.
  - `locate(folder, path)` finds a workspace file to open in its own app or
    show in its folder, and says whether Windows may open it.
  - `drawPage(conversation, revision, page, width)` answers one page as a PNG
    data URL, or the sentence saying it could not be drawn.
  - `state(conversation)`, `onChange(listener)`, `close(conversation)`,
    `forget(conversation)` and `shutdown()`.
- `mayOpenInItsOwnApp(path)` says whether Windows' own app may be offered for
  a file.
- `serveDrawing(port, { fallbackFont? })` is what runs inside the drawing
  process, drawing with the given font the characters a page's fonts lack. `DrawingHost`,
  given a `StartDrawingProcess` and a `DrawingContainment`, is the core's side
  of one process.
- `new ContainedPdfPages({ start, containment, timeoutMs?, idleMs? })` reads
  PDFs for the model. `open(bytes)` answers each page's size in points and
  lets the caller read a page's text items or draw it as a JPEG at a scale, or
  says it could not start a process or open the document. `words(bytes)`
  answers each page's words, or nothing when the document cannot be read; the
  core uses it to compare a changed PDF. `close()` ends its process. The
  composition root hands it to the tools as their PDF pages source.
- `new ContainedPictures({ start, containment, timeoutMs?, processMemoryLimit?,
  idleMs? })` makes pictures smaller for the model. `smaller(bytes, width)`
  answers the picture drawn that wide as a PNG with its size, or nothing when
  it could not be decoded or drawn. `close()` ends its process. The
  composition root hands it to the picture fitting as where a picture is
  drawn smaller.
- The types these take and return: `DrawingPort`, `DrawingReply`,
  `DrawingRequest`, `DrawingProcess`, `LocatedDocument`, `ShowOutcome`,
  `ContainedPdf`, `SmallerPicture`.

## Invariants

- **Drawing happens in a contained process, never in the core.** Nothing is
  sent to a process before it is in its Job Object. Requests go to it one at a
  time, so its ten seconds count a page's own work, not the wait behind
  others. A page that takes longer ends its process wherever it is stuck; a
  process past its memory limit of 1 GB ends alone; one that crashes is
  replaced. Whatever
  ended it, the waiting requests fail, and the next request goes to a new
  process that is given the document again. A page the panel asked for that
  was waiting is asked for once more, never the page the process ended under,
  so a page that never finishes or brings its process down costs only its own
  drawing. A process that cannot be
  contained is ended and draws nothing. One that could not be started fails
  its request with the sentence saying no contained process could draw it,
  never leaving the panel opening, and the next request starts one again.
- **Only pictures and page text leave the drawing process.** A document goes
  in as bytes; a page comes back as PNG or JPEG bytes with its size, or as its
  text items, and nothing else. The process opens none of the person's files
  and no connection: it reads only what ships with the app, pdf.js's own files
  and the fallback font, and the fonts installed on the machine. A PDF carrying script, a link, a form that submits and a crafted
  font is drawn with none of them running.
- **A file is what its bytes say.** A PDF, PNG, JPEG, GIF, WebP, BMP or SVG is
  recognised from its head, not its extension, by the same answer the agent's
  file tools get (file kinds). An SVG may open with a byte-order mark, an XML
  declaration, comments and one DOCTYPE among them, as matplotlib, Graphviz
  and Illustrator write it; one whose DOCTYPE declares anything of its own is
  not taken for a picture, so no entity is ever expanded. The head is read in
  one pass, so an SVG that opens with many comments cannot stall the main
  process.
- **Pages are drawn sharp and bounded.** A PDF page is drawn at the width
  asked for, never past twice its own size. A picture is never drawn past its
  own pixels, and at most 2,000 pixels on its long side.
- **An SVG is sized before it is decoded, and draws only what it holds.**
  Decoding draws it at the size it declares, so its width, height or viewBox
  are read first and written back within 2,000 pixels; one that declares no
  size is refused as damaged. Nothing it refers to (an address, a file, a
  stylesheet, a font, the DTD its DOCTYPE names) is reached. An SVG is never
  offered to its own app, a browser that would run its scripts. Its Chinese,
  Japanese and Korean text is drawn with the fallback font, and its Latin text
  in the family it names.
- **Only the conversation's workspace is shown.** A path outside it, absolute
  or through a link, is refused before anything is read, and the panel stays
  as it was.
- **What cannot be drawn says why, in place of the pages.** Too large (over
  100 MB, said with its size and without reading it), too many pages (over
  2,000), damaged, protected by a password, not a PDF or a picture, gone, or
  no contained process to draw it: each has its own sentence.
- **A page the document does not have is refused with the page count**, and
  changes nothing shown, nor the redraw a written document is still owed.
- **The document shown is the last one written, or the one asked for.** Only
  a written file whose name is a PDF or a picture counts, and the 20 most
  recent are listed for the panel's menu. A redraw still owed to a document
  written earlier is dropped when another is written or asked for. Of two
  documents asked for at once, the later is shown; a request refused as
  outside the folder, by its name or through a link, overtakes nothing, and a
  panel closed while a document is being looked for stays closed. A request
  for a page that is not there changes nothing shown: one that overtook a
  document still opening puts back what the panel showed before it.
- **Writes in a burst are drawn at most once a second, the latest last.** The
  first is drawn at once; whatever is on disk when the interval ends is drawn
  next.
- **Pages belong to one revision of the file**, named by a hash of its bytes.
  A page asked for from a revision no longer shown is refused rather than
  drawn from the new file. The pages drawn for the shown revision are kept
  while they fit in about 64 MB, so a page asked for again is answered
  without a process.
- **A file put back is drawn again from disk, or said to be gone.** A
  closed panel stays closed.
- **Each conversation's document is its own**, with its own drawing process.
  Closing one leaves the others.
- **The four conversations used last keep their documents in memory.**
  Showing a document, drawing it again, and drawing one of its pages are
  use. Past four, those used longest ago let go of their documents, drawn
  pages and processes, and their panels stay as they were; one still loading
  a document or drawing a page keeps them until it is done. When such a
  conversation is used again, its file is read once more from disk, once
  however many of its pages are asked for at once, and never over a document
  asked for before. A file changed meanwhile is shown as it is now, and a
  page asked for from what it was is refused; one that now leads outside the
  folder is said to be outside it. Nothing is read again for a conversation
  forgotten, or once the viewer is shut down, and a conversation closed or
  forgotten while its document is being read starts no process for it.
- **A drawing process asked nothing for a minute ends** (ADR 0023); one still
  working on a request is kept. The document stays in the core, so the next
  page is drawn by a new process given the document again, and the panel does
  not change. Letting go of a document starts no process and keeps none
  running.
- **Windows' own app is offered only for documents and pictures**: PDFs,
  common picture formats, and Word, Excel and PowerPoint files. Nothing
  Windows could run is offered, and a link is judged by the file it leads
  to.
- **A PDF the model reads is read in a contained process too**, one shared by
  every conversation, started on the first read and ended after a minute with
  nothing read. A read that could not start it says so. A page stuck in it
  costs that answer, within the time limit, and the next read starts a new
  process. A page's line breaks are kept in its text, so the words on either
  side stay apart.
- **A picture made smaller for the model is decoded in a contained process
  too**, started on the first and ended after a minute with none asked for,
  and keeps its transparency, where the panel draws pages on white. A
  picture that is not one, a process that falls over, or one past its memory
  limit costs that picture, and the next is drawn by a new process.

## Testing notes

The drawing service is tested in the test process against real PDFs built by
the tests, a password-protected one and a hostile one among them, and real
pictures. The process paths (a hang, memory past the limit, a crash, a process
that cannot be contained, one left idle) are tested against real Node
processes in real Job Objects, because a fake cannot show that a process
ended.

These tests run pdf.js in plain Node. In the app it runs on a worker thread
inside an Electron utility process; an installed test draws a page through the
built app that way and checks the page carries its text.
