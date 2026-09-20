# 0036. The contract holds what layers must agree on exactly

Status: accepted

Amends 0034's description of the contract layer.

## Context

ADR 0034 describes the contract as the types that cross to the renderer, plus
the command list. Two agreements did not fit that description and were written
twice instead:

- The core and the agent loop each defined a failure whose message is meant for
  the person, and each recognised the other's by comparing `error.name` to the
  string `"VisibleError"`. Nothing failed if one side changed the spelling.
- The names of who owns a tool call were written in the capabilities group and
  again in the permission engine, agreeing by coincidence.

Neither crosses to the renderer, so by the letter of 0034 neither belonged in
the contract; and no other package may hold them, because a feature imports the
contract and nothing else.

## Decision

The contract holds the few things more than one layer must agree on exactly,
whether or not they reach the renderer. That includes a runtime value where a
type alone cannot be checked — it already exports the channel list and the
bridge key — and it now holds the person-facing failure and the tool-owner
names.

What stays out: anything a single feature owns, and anything with behaviour.
The contract remains a vocabulary. A value belongs here only when two packages
would otherwise agree by convention, and the agreement can then be broken by a
compiler rather than by a test.

## Consequences

- Renaming the failure or an owner name breaks typecheck instead of passing
  silently.
- The contract carries a small amount of runtime code, so it is no longer types
  only. It stays free of logic.
- The bar is deliberately high: a second package needing something is not a
  reason to move it here, unless neither package can own it.
