---
status: open
effort: Low
blocked-by:
---

# A turn records which upstream answered it

## What

OpenRouter reports the serving upstream on every streamed chunk as a
`provider` field. Carry it out of the model client as a typed model event,
store it on the turn alongside usage, and show it where an action's evidence
is already shown. One name per model response, not per allowlist.

## Why

ADR 0022 replaced a single-provider pin with a measured allowlist, which trades
exact reproducibility for availability. That trade is only defensible if a
substitution is visible after the fact: right now any allowlist member may have
answered a given request and nothing records which, so a problem seen once
cannot be attributed to the machine that produced it. This is the missing half
of the decision, not a refinement of it — the pin's original purpose was that
nothing in the app showed the swap, and an allowlist without attribution has
the same blind spot with more upstreams behind it.

## Done when

A completed turn carries the name of the upstream that produced it, a named
test asserts the field survives the streaming parser without exposing other
wire fields, and two turns answered by different providers are
distinguishable in stored task history.

## Notes

The field arrives on each chunk, not only the first, and is absent from the
final `[DONE]` frame — read it from the first chunk that carries it rather
than the last.

Deliberately excluded: exposing it as a user-facing setting. This is evidence
about what happened, not a control.

## What is left, 2026-09-10

The recording half is done and tested. The provider, generation id, resolved
model, finish reason, terminal signal, and usable-output status are stored per
model response; `streams provider text and authoritative usage without exposing
wire fields` asserts the parser carries the name and nothing else off the wire,
and `restores the provider evidence for each model response` asserts it
survives a restart.

What remains is the half the task was written for: nothing in the interface
reads `modelResponses`, so a substitution is recorded and still invisible. Two
turns answered by different upstreams look identical to the person reading the
conversation. Show it where an action's evidence is already shown.
