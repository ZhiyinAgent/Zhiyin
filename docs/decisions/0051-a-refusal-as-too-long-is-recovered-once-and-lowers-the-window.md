# 0051. A refusal as too long is recovered once, and lowers the window

Status: accepted; extends ADR 0050

## Context

ADR 0050 holds every request under a target set from the window the catalogue
lists. That prevents most overflows, but not all: the size of a request is an
estimate until the provider counts it, and providers differ in how they count
pictures, their chat templates and tool definitions. Some also take less than
they list. When a request was refused as too long, the turn failed, and the
next turn built the same request and failed the same way.

**Assumptions this decision depends on** (revisit it if any changes):

- OpenRouter reports a refusal as too long with a typed error
  (`context_length_exceeded`, errors reference, read 2026-09-23), before any of
  an answer is streamed. Other refusals carry other types, so recovery never
  fires on an unrelated one.
- When the provider states its limit, the limit is the window it will take.
  When it states only what was sent, its limit is below that; nine tenths of
  it is taken, which costs some room, not a second failure.
- A limit learned from one refusal holds for the rest of the session, for the
  model and upstreams it was refused on. Nothing records it across a restart,
  where the catalogue is read again.

## Decision

A model step refused as too long, before any of its answer showed, is
recovered once:

1. The window planned with is lowered, for the chosen model and upstreams, to
   the limit the provider stated; else nine tenths of what it said was sent;
   else nine tenths of what Zhiyin estimated. It is never raised this way.
2. The conversation is condensed to the budget's target within the lowered
   window, whatever its size, and the record says it followed a refusal.
3. The same step is sent again.

A second refusal on the same step ends the turn: "This conversation no longer
fits the selected model, even after condensing it." A refusal after some of
the answer showed is not recovered, since sending the step again would repeat
what the person has already read.

## Consequences

- One refusal costs a condensing and a retry, not the turn; the next turns
  plan within the lowered window and are not refused the same way.
- The budgets, the ring and "What's using space" follow the lowered window,
  which says it was lowered and after a refusal of what size.
- Choosing another model or other upstreams lets the lowered window go.
- A single message larger than the lowered window cannot be condensed smaller
  (a message is summarised whole, never cut), so its turn ends with the
  message above.
- Keying the limit by the upstream that refused, rather than by the whole
  choice, waits for the serving upstream to be recorded (audit task 25). The
  failure's two ways forward, a new conversation from the summary or a model
  with a larger window, wait for audit task 29.

Named tests: `is recovered once: condensed, noted as following the refusal,
and the same step sent again`, `plans with the provider's stated limit, so the
next ten turns are not refused`, `ends the turn saying the conversation no
longer fits when the retried step is refused too`, `is not recovered once the
answer has begun to show`, and `is never condensed, and leaves the window as
listed`.
