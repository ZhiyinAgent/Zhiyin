# 0046. Presentation and judgement are separate model seams

Status: accepted; amends two claims in ADR 0008

## Context

ADR 0008 introduced one auxiliary dependency for everything the loop asks a
second model: the plan, an action's title and description, whether a criterion
is satisfied, and — under ADR 0020 — the durable compaction summary. It recorded
two things about that dependency which are no longer true, and one grouping
which was never examined.

The first is the model. ADR 0008 named GLM 5.3 Flash for auxiliary work and
called model selection "an injected seam but not yet a user setting". A user
model selector exists now, and the composition wires the same client to both
seams. So auxiliary work follows whatever model the person selects: select an
expensive model and a dozen label-writing requests per turn follow it there;
select a weak one and the durable summary is written by it.

The second is cost. ADR 0008 assumed "acceptable latency and provider cost for
the current development milestone" on the basis of a small fixed model. That
assumption cannot hold for a dependency that tracks an arbitrary selection.

The grouping is the substance of this decision. The requests were treated as one
kind of work because they are all short and structured, but they are two:

- **Presentation** — the plan, the conversation's name, an action's title and
  description, and re-aiming a refused call. Wrong here costs a worse label,
  and the interface shows the person what it produced.
- **Judgement** — whether bounded evidence satisfies a criterion, and what the
  compaction summary must preserve. Wrong here is wrong in ways nothing
  downstream can detect: a criterion is silently marked unresolved, or a fact
  the summary dropped is simply absent from every later turn.

The difference matters as soon as the two could be served by different models.
Running presentation on a small local model is plausible; running the summary
every later turn depends on through the same model is not the same proposition,
and one dependency could not express the difference.

**Assumptions this decision depends on** (revisit it if any changes):

- Both seams stay non-authoritative under ADR 0008: neither can grant, refuse,
  or alter an action.
- A composition that points the two at different models accepts that the plan
  and the assessment of it may then disagree in wording.
- Presentation output is shown to the person, so its errors are visible;
  judgement output is not independently checked by anything.

## Decision

The loop declares two model dependencies, `guidanceModel` and `judgementModel`.
Each auxiliary request is sent through the one matching its kind. Both requests
still carry the reasoning and output bounds set in one place, and both are still
read by the parsers that decide whether an answer is usable.

The conversation's name is asked for by the request that already has the
context to answer it: the first-message name comes with the plan, and a
compacted conversation is renamed by the compaction request itself rather than
by a second request reading only the summary it produced.

The composition points both at the selected model today. The seams are named
apart so that changing one does not change the other.

## Consequences

- A later composition can serve presentation from a local model without moving
  judgement or compaction with it, which is what makes that experiment
  answerable rather than all-or-nothing.
- Compacting costs one request rather than two, and the request that names a
  conversation is the one that has read the whole of it.
- Two dependencies is more wiring than one, and a composition that forgets the
  distinction can still pass the same client to both — as this one does. The
  names are the only thing carrying the distinction.
- ADR 0008's cost assumption is withdrawn rather than repaired. What auxiliary
  work costs now depends on a person's model selection, and no measurement here
  survives a different selection.
