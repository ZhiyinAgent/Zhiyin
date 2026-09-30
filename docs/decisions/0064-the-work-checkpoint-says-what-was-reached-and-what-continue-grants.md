# 0064. The work checkpoint says which limit was reached, in one sentence

Status: accepted; amends ADR 0038

Date: 2026-09-30

## Context

The checkpoint of ADR 0038 stops a stretch of work at 24 tool rounds, 30
minutes or USD 10 of provider-reported cost. The question shown to a person
carried only the round count: "This task has completed 17 tool rounds." A
person could not tell why the work stopped at 17 when the limit is 24, what
"tool rounds" are, what the work had cost, or what either answer would do.
A choice made without that is not an informed one.

## Decision

The work-budget request carries where the stretch stands: which limits it
reached, the rounds completed, the elapsed time, the provider-reported cost
when any request reported one, and the allowance Continue grants.

The question is one row: its title, one sentence naming the limit reached in
plain words (steps, minutes or cost), and Pause and Continue. Nothing else is
shown except, when Zhiyin saw the work repeat itself, what repeated. A first
version also listed what was used and what each answer grants; the person
found it far too much to read for a yes-or-no question, so the rest stays in
the request, unshown.

## Assumptions

- A tool round reads as a step to a person; the word "tool round" means
  nothing to them.
- The allowance a stretch renews to is the one it started with.

## Consequences

The request is part of the saved workspace format, so its new fields are
validated on load. A saved conversation waiting at this question from before
the change reads as damaged; the app is unreleased, so there is no migration.
