# 0003. The window is a sandboxed view of core state

Status: accepted

## Decision

- **The window has no privileges.** It runs with context isolation, the
  Chromium sandbox and no Node integration. Its content security policy loads
  only its own files, and images only from itself or as `data:` URLs. It cannot
  navigate or open another window. Its code imports nothing from Electron, and
  from the workspace only the contract and the pure packages (ADR 0002).
- **The bridge is the contract and nothing else.** The preload script exposes
  one function per command channel, and two subscriptions: the core's events
  and its view checks. The main process accepts a command only from its own
  window's top frame, and the core checks every command's arguments before it
  answers.
- **The core owns the state.** The window builds its copy from one snapshot and
  the numbered changes that follow, applied in order. When a change is missing,
  it asks for that conversation whole. A conversation's state is one phase from
  a closed set, so contradictory states cannot be expressed. The window never
  marks work approved or done on its own.
- **An answer carries the core's own request id.** An approval or an answer to
  a question is accepted only for the exact request the core issued and is
  still waiting on, in that conversation.
- **The window loads nothing untrusted as a document.** Browser pages and
  document pages arrive as images. Model text is rendered as Markdown with raw
  HTML left out.

### Links in an answer

- **A link to an http or https page opens in the person's default browser
  when they click it.** It reads as a link: its words, underlined, then the
  site it goes to, short and muted ("The doc · github.com"). The whole address
  is on the link for whoever points at it. An address that is its own words is
  given once.
- **The site is named as the browser will reach it.** A name outside ASCII
  shows as the browser resolves it (`xn--bcher-kva.de`), so a name made to
  look like another's reads as what it is.
- **Only web pages open.** The core refuses anything but an http or https
  address with a host and no name or password in it, up to 2,048 characters:
  never a file, a program, a share or a settings page, whatever the window
  asks. This is a channel of its own, apart from the fixed list of pages the
  window may open for itself.
- **A link to anything else stays its words**, with nothing to press. A page
  citation is a button that asks the core to show that page.
- Nothing opens without the person's click, and nothing in the window
  navigates.

### The one question the core asks the window

- **The core asks the window whether a diagram or chart can be drawn**,
  because only the library that draws it can say. It waits at most ten
  seconds. A view that could not be checked is not shown, and the model is
  told why.
- **The answer may also carry what drawing the view decided.** Once a view can
  be drawn, the window draws it out of sight as the conversation lays it out,
  and answers with a sentence per thing the drawing library chose (names cut
  short, an axis read as time or as categories, a histogram's bins, a box
  plot's whiskers, a diagram's size) and a PNG of it.
- **The model is told what the view came out as.** The tool answer that shows
  a view carries those sentences, and the picture for a model that takes
  pictures. The view stays in the conversation as its source; the picture is
  kept beside the action, as any tool's picture is.
- **What the window says is bounded, and optional.** The core keeps the first
  60 sentences, each up to 1,000 characters, and a picture only when it is a
  base64 PNG of at most 8 MB of text; anything else is dropped. A drawing that
  fails or takes more than four seconds leaves the view accepted without
  them. The sentences reach the model as tool output, which is data and never
  instructions (ADR 0016).

### A drawn view saved to a file

- **A chart or diagram tool takes `save_to`, a workspace path ending in
  `.svg`.** The window that drew the view also gives the drawing as a file,
  the same standalone SVG the person's Save writes.
- **The file is written by `write_file`, as a call of its own.** Once the view
  is shown, the loop runs `write_file` with that path and those exact bytes,
  through the same permission decision, approval card, backup and rewind as
  any write. The person approves the bytes that are written, never a promise
  of them.
- **The view's answer says what became of the file:** written, with its size,
  or why not: declined, the window gave no drawing, or `write_file` is not
  offered here. A view without `save_to` asks for no file.

## Why

The window is where untrusted content is shown: model text, web pages,
documents. If it were compromised, the most it could do is send typed commands
the core checks, from the one frame allowed to send them.

Holding state in the core lets the window be reloaded after a crash with the
work intact, and keeps one source of truth for what was approved.

Answers link to their sources. A link that shows its site, and its whole
address on pointing, lets the person see where it goes without opening it,
and opens with one click.

A model that writes a chart cannot see that its labels were cut short, that
its dates were read as categories or that one outlier flattened every other
bar, so it reports a chart that looks wrong as done. Only the library that
draws the view can say what it decided, and that library is in the window.
The cost is that text and a picture made by the window, which shows untrusted
content, reach the model; the bounds and the tool-output fence keep that to
data of a known size.

A chart the model draws for the person needs a way into a report. Drawing it
again with Python or Typst can look different from what the person saw, and
can even show other numbers. Saving the drawing the person saw keeps the two
the same, and writing it through `write_file` adds no new way to write files:
whatever binds, limits and undoes a write already applies.

## Rejected

- Validating or describing diagrams in the main process or the core with a
  second copy of the drawing library: it can disagree with the copy that draws,
  and without a DOM it rejects diagrams that are correct.
- Telling the model only the source it wrote: that lets wrong charts be
  reported as finished.
- State owned by the window and synchronised to the core: lost on reload, and a
  second authority over what was approved.
- Drawing documents or web pages inside the window: a crafted file would run
  in the window's process (ADR 0018, ADR 0019).
- Asking before opening each link: one more click for every source an answer
  cites, for a step the person already chose by clicking. The owner chose
  clicking without a question (2026-11-04).
- Links that cannot be clicked, with the address printed after them: the
  person copies the address by hand to read a source, and the long address
  wraps badly.
- Drawing charts in the core so saving does not depend on the window: the
  charts would be drawn twice, by two codebases that can disagree.
- A write inside the view tool: it would bind the approval to a source and a
  path, not to the bytes written, and add a second way to write files.

## Assumptions

- Zhiyin has one window, and it is open while a turn runs. When it does not
  answer, a view is not shown, and no file is written.
- Ten seconds is long enough to check a view on a slow machine. Past it, a busy
  window costs one view, not a stalled turn. Drawing a view out of sight takes
  well under four seconds.
- The few things a drawing library decides by itself can be named one by one;
  a new kind of view adds its own.
- The drawing is laid out 720 pixels wide in the window's theme, as the check
  draws it; the person's Save of the same chart in a narrower or wider card
  can differ in width. An SVG of the largest chart fits `write_file`'s 2 MiB
  limit; a bigger one is refused by `write_file` and said.
- An address in an answer is the model's choice, and a conversation steered by
  a page it read could write a link whose address carries something private to
  a site that collects it. The person clicking it sends that. The site is shown
  next to the words so a strange one stands out; the permission engine's
  asking when outside content and private data meet (ADR 0012) does not cover
  a click. If this proves to matter, a link in a conversation holding both is
  the one to ask about first.
- The default browser is the person's own, with their sign-ins: a link opens
  as any link they click elsewhere would.
