# 0003. The window is a sandboxed view of state the core owns

Status: accepted

## Decision

- **The window has no privileges.** It runs with context isolation, the
  Chromium sandbox and no Node integration. Its content security policy loads
  only its own files, and images only from itself or as `data:` URLs. It cannot
  navigate or open another window. Its code imports nothing from Electron and
  nothing from the workspace but the contract.
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
- **The core asks the window one kind of question**: whether a diagram or
  chart can be drawn, because only the library that draws it can say. It waits
  at most ten seconds. A view that could not be checked is not shown, and the
  model is told why.
- **The window loads nothing untrusted as a document.** Browser pages and
  document pages arrive as images. Model text is rendered as Markdown with raw
  HTML left out. A link in a message never navigates: a web address is shown as
  text beside its words, and a page citation is a button that asks the core to
  show that page.

## Why

The window is where untrusted content is shown: model text, web pages,
documents. If it were compromised, the most it could do is send typed commands
the core checks, from the one frame allowed to send them.

Holding state in the core lets the window be reloaded after a crash with the
work intact, and keeps one source of truth for what was approved.

## Rejected

- Validating diagrams in the main process with a second copy of the drawing
  library: it can disagree with the copy that draws, and without a DOM it
  rejects diagrams that are correct.
- State owned by the window and synchronised to the core: lost on reload, and a
  second authority over what was approved.
- Drawing documents or web pages inside the window: a crafted file would run
  in the window's process (ADR 0017, ADR 0018).

## Assumptions

- Zhiyin has one window.
- Ten seconds is long enough to check a view on a slow machine. Past it, a busy
  window costs one view, not a stalled turn.
