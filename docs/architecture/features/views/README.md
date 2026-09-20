# Views

## Purpose

Carries one question to the surface that draws diagrams and charts and brings its answer
back. Whether a diagram can be drawn is knowable only where the drawing library
is, and that is not the process the agent loop runs in (ADR 0017). This is the
correlation between asking and being answered, and the bound on how long the
core will wait.

It is the drawing-validation reply path: unlike a quiz or clarification, it is
answered by the renderer itself and never becomes task state (ADR 0021).

## Boundaries

- **Owns:** matching an answer to the question that produced it, the timeout,
  and what an unanswered question means.
- **Does not own:** how the question travels (the caller supplies that),
  drawing anything, judging validity, deciding what to do with a failure, or
  repairing source.
- **Talks to other features only through:** a question in, an outcome out.

## Public interface

- `validate(kind, source)` asks whether a view can be drawn and resolves with
  the answer, or with an unchecked outcome if none arrives.
- `answer(requestId, outcome)` delivers what the drawing surface replied.
- `abandon()` gives up everything still waiting, for when that surface is gone.

The agent loop is given `ViewValidator` — `validate` alone. It never learns
that a renderer exists.

## Invariants

- A tool result is shown only after the drawing surface accepted the exact
  stored source. The named test `checks, runs, and persists an inert view
  without requesting permission` guards the orchestration side, and `answers
  core view checks from the renderer that owns drawing` guards the bridge.

- An answer reaches the question that asked it, whatever order answers arrive
  in. The named test `answers overlapping questions each with its own answer`
  guards this; answers coming back in the order they were asked is a
  coincidence, not a property.
- A surface that never replies does not hold a turn open. The named test `gives
  up on a surface that never answers instead of stalling the turn` guards the
  timeout, and `stops waiting when the surface it was asking has gone` guards
  the same outcome reached by teardown.
- Not judged is never reported as judged and wrong. Every unanswered question
  resolves to the same "could not be checked" outcome, so a repair model is
  never handed an invented complaint to work from. The tests above and `reports
  a surface that cannot even be asked, rather than waiting for it` all assert
  that one wording.
- A late or unknown answer is ignored rather than fatal. The named test
  `ignores an answer to a question it is no longer waiting for` guards it: a
  reply that lost a race and a reply that was never asked for are
  indistinguishable here, and neither is worth failing over.
- The drawing library's own complaint survives the trip, for the repair to work
  from. The named test `keeps the drawing library's own complaint, for the
  repair to work from` guards it.

## Testing notes

Tested with no transport at all: the test supplies `ask` and answers by hand,
which is the whole point of the caller owning transport. Timeouts use fake
timers rather than real waiting.

## Open questions

- The timeout is one number for every kind of view. A chart of many points may
  legitimately take longer to draw than a small diagram, and nothing here
  distinguishes them yet.
- The renderer timeout is shared across view kinds. If real large charts prove
  slower than Mermaid parsing, that may need to become kind-specific.
