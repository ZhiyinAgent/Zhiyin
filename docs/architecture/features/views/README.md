# Views

## Purpose

Carries one question to the renderer and brings its answer back: can this
diagram or chart be drawn? Only the renderer, which holds the drawing
libraries, can tell, and it is not the process the agent loop runs in
(ADR 0003). This feature matches each answer to its question and bounds how
long the core waits.

The agent loop adds a view to the conversation only after the renderer has
accepted its exact source. The question and its answer never become part of
the conversation.

## Boundaries

- **Owns:** matching an answer to the question that produced it, the timeout,
  and what an unanswered question means.
- **Does not own:** how the question travels (the caller supplies `ask`),
  drawing, judging whether a source is valid, deciding what to do with a
  failure, or repairing a source.
- **Talks to other features only through:** a question in, an outcome out.

## Public interface

- `validate(kind, source)` asks whether a view can be drawn and resolves with
  the answer, or with an unchecked outcome if none arrives.
- `answer(requestId, outcome)` delivers what the renderer replied.
- `abandon()` gives up on every question still waiting, for when the renderer
  is gone.

The agent loop is given `ViewValidator`, which has `validate` only, and never
learns that a renderer exists.

## Invariants

- An answer reaches the question that asked it, in whatever order answers
  arrive.
- A renderer that never replies does not hold a turn open. A question gives up
  after 10 seconds, or at once when the renderer is gone or cannot be asked.
- Not checked is never reported as checked and wrong. Every unanswered
  question resolves to the same outcome, "The view could not be checked in
  time.", so a repair is never asked to fix an invented complaint.
- A late or unknown answer is ignored. A reply that lost the race against the
  timeout and a reply to a question never asked look the same here.
- The drawing library's own error message reaches the caller unchanged, for
  the repair to work from.

## Testing notes

Tests use no transport: they supply `ask` and answer by hand. Timeouts use
fake timers.
