# 0018. Documents are read and drawn in a contained process, and only pictures reach the window

Status: accepted

## Decision

- **Zhiyin reads PDFs and pictures.** `read_document` refuses Word, Excel and
  PowerPoint files, saying which kind of file it is; Windows' own app can still
  be offered to open one.
- **Parsing happens in a contained process.** Pages the person sees are drawn
  in an Electron utility process, one per conversation showing a document.
  PDFs the model reads are opened in one shared process of the same kind,
  which ends a minute after its last read. Each process is put in a Job Object
  with a memory limit before it is given anything (ADR 0004). A page that
  takes longer than ten seconds ends its process wherever it is stuck, and the
  next request starts a new one. Inside the process, pdf.js runs on a Node
  worker thread, where it takes its Node code paths.
- **pdf.js runs with no system fonts, no embedded font faces and a cap on the
  size of images it decodes**, in a version that has no way to evaluate what a
  document contains. An SVG is sized before it is decoded and reaches nothing
  it refers to.
- **Only pictures and text leave the process.** A document goes in as bytes; a
  page comes back as an image and its size, or as its text. The window shows
  the drawn page as an image (ADR 0003). No document, font, script, link, form
  or embedded file is loaded by Electron or by the window.
- **Only the conversation's workspace is drawn.** A path outside it, directly
  or through a link, is refused before it is read. Files over 100 MiB and PDFs
  over 2,000 pages are not drawn. Every failure shows a sentence saying why in
  place of the pages.
- **Reading a document shows it.** When the main agent reads a workspace
  document with `read_document`, it is shown in a panel beside the
  conversation at the first page read, and the read's answer tells the agent
  what the person now sees. A document Zhiyin writes opens that panel the
  first time. A choice the person makes about what the panel shows holds until
  the turn ends, and once they have closed the panel, a later read leaves it
  closed. Specialists' reads show nothing (ADR 0015).
- **The agent cites a page as a link** to the document's workspace path ending
  in `#page=N`; each read gives it the exact link. Clicking one asks the core
  to show that page, which refuses a path outside the workspace or a page the
  document does not have.

## Why

A document can come from anywhere: a download, an attachment, a folder the
person chose. pdf.js has had flaws that let a crafted PDF run script, and its
canvas draws in native code, where a fault ends the process it runs in. A
worker thread's memory limit covers the JavaScript heap, not the buffers pdf.js
decodes images into, and `terminate()` cannot interrupt a native call that
never returns. Inside the core, either failure would end every running
conversation; in a contained process, it costs a page.

What the agent reads is what the person sees, so the person can check an
answer against the page it rests on, and the citation keeps that page one
click away after the conversation ends.

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
- A separate tool for showing a page: two tools for one file, and the model
  has to choose between them.
- Reading Office formats: left out by choice; a document saved as PDF is read.

## Assumptions

- A Job Object memory limit holds native allocations, and closing the Job
  Object ends a process stuck in native code.
- `process.type` is undefined on a worker thread inside a utility process.
  Electron does not document this; the drawing thread checks it and refuses to
  start otherwise.
- A page drawn as an image at the panel's width is sharp enough to read.
- One shared reading process is worth a read in flight failing when another
  document ends the process; the model reads again.
