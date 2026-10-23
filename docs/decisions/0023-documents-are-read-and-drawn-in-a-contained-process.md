# 0023. Documents are read and drawn in a contained process, and only pictures reach the window

Status: accepted

## Decision

- **Zhiyin reads PDFs and pictures.** `read_document` refuses Word, Excel and
  PowerPoint files, saying which kind of file it is; Windows' own app can still
  be offered to open one.
- **Parsing happens in a contained process.** Pages the person sees are drawn
  in an Electron utility process, one per conversation showing a document.
  PDFs the model reads are opened in one shared process of the same kind. Each
  process is put in a Job Object with a memory limit before it is given
  anything (ADR 0005). A page that takes longer than ten seconds ends its
  process wherever it is stuck, and the next request starts a new one. Inside
  the process, pdf.js runs on a Node worker thread, where it takes its Node
  code paths.
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
  closed. Specialists' reads show nothing (ADR 0019).
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
- Keeping a conversation's drawing process while its panel shows a document:
  conversations left hours before keep theirs.
- Ending the panel's processes with the rest of a conversation left alone (the
  core's rest after 15 minutes, which ends its browser and Blender): processes
  of every conversation visited in the last quarter of an hour stay, the core
  would have to reach into the viewer's processes, and the reading process
  would keep a rule of its own. Its advantage, no restart in the conversation
  on screen, is worth about 200 ms on the first page not yet drawn after a
  minute of reading.
- Forgetting the documents with the process: the next page would be drawn
  from the file as it is then, which may no longer be the revision shown.
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
- Starting a process and opening a document again takes a fraction of a
  second. Measured for a small PDF; a large one takes longer to open, in
  proportion to what pdf.js parses.
- A document's bytes kept in the main process cost less than a process: at
  most 100 MB, the panel's limit, and usually far less.
- A minute tells a person reading a page from a conversation left alone.
  Someone who reads one page for longer waits once for the next page not yet
  drawn.
