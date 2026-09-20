---
status: open
effort: Low
blocked-by:
---

# One request assesses the whole plan

## What

Assess the remaining criteria in one request instead of looping one request
per item. The loop is sequential and re-sends the same response and action
evidence on every pass.

The other half of this task is done: the planner is now told to return no
items when the reply itself answers the request, so a conversational message
produces no plan and nothing to assess. Creating the plan lazily from the
action trace, rather than predicting it before the turn starts, remains
available if plan quality turns out to need it.

## Why

The assessment is what a person waits on after the answer is already on
screen: one request per unverified item, in series, each re-sending the same
response and action evidence.

## Done when

A turn that runs several tool calls closes with one assessment request rather
than one per unverified item.

## Notes

- The first-message conversation name is bundled into the plan request. Any
  later move to lazy plan creation must split them, or the name is deferred
  with the plan.
