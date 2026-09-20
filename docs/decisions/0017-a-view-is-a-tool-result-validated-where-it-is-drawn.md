# 0017. A view is a tool result, and it is validated where it is drawn

Status: accepted

## Context

Some things are clearer as a picture than as a paragraph, and the agent
currently has no way to show one. The product evaluation's data case expects a
report whose chart and export agree; there is no way to draw a chart at all, so
that case cannot be run.

Two tools are wanted first — a diagram and a chart — and building either one
alone would answer the questions they share by accident, in whichever way that
tool happened to need. `tasks/display-tools.md` collected those questions. This
decides them once.

The awkward one is validation. Model-authored diagram source is often very
nearly right, and a near-miss should be repaired quietly rather than shown
broken, which is the pattern ADR 0016 already established for refused edits. But
repair is driven from the core, and whether a diagram is valid is a question
only the drawing library can answer.

## Decision

**A view is a tool result, never prose.** A view appears because a tool produced
it. Fenced diagram source written in an ordinary message stays text. This keeps
a view in the action record, makes it inspectable, and stops a model from
drawing on the interface by writing Markdown at it.

**Showing a view asks nobody's permission; saving one asks like any other
write.** Rendering happens inside the conversation and changes nothing outside
it, so a prompt would be asking permission to finish speaking. The cost of
asking is not neutral: a person taught to click through prompts that never
mattered is a person less likely to read the one that does. The boundary is that
a view is inert — the moment it becomes a file, it is a write.

**A view is stored as its source, never as a picture.** The conversation is
durable, so a view has to be re-renderable after a restart from what was stored.

**Validation lives with the renderer, which means the bridge gains a direction:
the core may ask the renderer a question and wait for an answer.** Until now the
renderer asks and the core answers, or the core notifies and the renderer
listens; nothing went core-first and expected a reply.

The alternative was to validate in the main process. It works —
`docs/reference/stack.md` records it verified by running it under jsdom — and it
was rejected for two reasons. It ships a second copy of the drawing library that
can disagree with the one that draws, so a diagram could validate and then fail
to appear; and validating without a DOM, which would have avoided that, reports
*correct* diagrams as failures for reasons internal to the library.

A validation request that is not answered promptly is abandoned, and a view that
cannot be validated is reported to the model as unvalidated rather than shown
broken or silently dropped.

Assumptions: the surface that draws a thing is the only honest judge of whether
it can be drawn; a person wants the picture, not a report that the first attempt
at expressing it did not parse; near-miss source is the common case and
unsalvageable source is not.

## Consequences

Diagrams and charts, and whatever follows them, share one shape: a submodule
with its own arguments, its own validation, and its own component, over a
mechanism that already knows how to validate, repair, store and restore.

The bridge direction is the real cost. The core can now block on the renderer,
and a renderer that is slow, busy, or gone becomes a way to stall a turn. The
timeout is what stands between that and a hung task, which makes it load-bearing
rather than defensive, and it is the thing most likely to be wrong under a
machine that is genuinely slow rather than merely unresponsive. It also widens
what a compromised renderer could influence, from answering its own questions to
answering the core's — bounded, because the answer is "this drew" or "this did
not", but no longer nothing.

Quiet repair of diagram source inherits ADR 0016's unfixed exposure: a repair
that produces a *different* valid diagram is indistinguishable, mechanically,
from one that fixes a typo. A wrong diagram is a wrong argument about how
something is arranged, and nothing here catches that. The source view is the
mitigation, and it is a mitigation only for a reader who looks.

Validating is not sanitising. Source that parses can still contain a hostile
label, so the drawing surface stays responsible for refusing script and for
staying inside its own view, whatever the library does by default.
