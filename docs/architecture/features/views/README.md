# Views

## Purpose

Carries one question to the renderer and brings its answer back: can this
diagram or chart be drawn, and once it can, what did drawing it decide? Only the renderer, which holds the drawing
libraries, can tell, and it is not the process the agent loop runs in
(ADR 0003). This feature matches each answer to its question and bounds how
long the core waits.

The agent loop adds a view to the conversation only after the renderer has
accepted its exact source. The question and a refusal never become part of
the conversation; what an accepted view's drawing decided, and its picture,
are what the loop tells the model the view came out as (ADR 0003).

The window draws an accepted view out of sight, as the conversation first
lays it out, 720 pixels wide, in its theme, and says what it decided: a bar
chart's names cut short, a line chart's x axis (numbers, time, or categories
and the value that kept it from being time or numbers), each axis's span, a
histogram's bins and why that many, a box plot's five numbers, how far
its whiskers reach (by Tukey's rule unless its range is asked for), its
outliers, the first ten named, and which neighbouring group names overlap, a diagram's kind and size. The picture
is the file the person's Save writes, on the window's ground, at twice its
drawn size up to 1,600 pixels on its longer side. A drawing that fails or
takes more than four seconds leaves the view accepted without them.

## Boundaries

- **Owns:** matching an answer to the question that produced it, the timeout,
  and what an unanswered question means.
- **Does not own:** how the question travels (the caller supplies `ask`),
  drawing, judging whether a source is valid, or deciding what to do with a
  failure.
- **Talks to other features only through:** a question in, an outcome out.

## Public interface

- `validate(kind, source, { file? })` asks whether a view can be drawn and
  resolves with the answer, or with a refusal saying it could not be checked
  if none arrives.
  With `file`, an accepted view also comes back as a file, the standalone
  SVG the person's Save writes.
- `answer(requestId, outcome)` delivers what the renderer replied. An
  accepted view may carry `drawn`: what drawing it decided, one sentence
  each, and a PNG of it.
- `abandon()` gives up on every question still waiting, for when the renderer
  is gone.

The agent loop is given `ViewValidator`, which has `validate` only, and never
learns that a renderer exists.

- `PendingViewChecks` implements `ViewValidator`: each view is checked by the
  window that draws it, within a time limit.

## Invariants

- An answer reaches the question that asked it, in whatever order answers
  arrive.
- A renderer that never replies does not hold a turn open. A question gives up
  after 10 seconds, or at once when the renderer is gone or cannot be asked.
- A drawing comes back as a file only when it was asked for, and only as an
  SVG of up to 2 MiB; any other is dropped and the view still accepted.
- Not checked is never reported as checked and wrong. Every unanswered
  question resolves to the same outcome, "The view could not be checked in
  time.", and never to a complaint the drawing library did not make.
- A late or unknown answer is ignored. A reply that lost the race against the
  timeout and a reply to a question never asked look the same here.
- **What the renderer says it drew is taken as words and a PNG of bounded
  size, or not at all**, since it comes from another process: the first 60
  sentences, each up to 1,000 characters, with a count of those left out, and
  a picture only when it is a base64 PNG of at most 8 MB of text. Anything
  else is dropped, and the view is accepted all the same.
- The drawing library's own error message reaches the caller unchanged, for
  the model to work from.

## Testing notes

Tests use no transport: they supply `ask` and answer by hand. Timeouts use
fake timers.

For the tests of the packages above it, `@zhiyin/views/testing` offers
`fakeViews()`, a checker that accepts every view (ADR 0002).
