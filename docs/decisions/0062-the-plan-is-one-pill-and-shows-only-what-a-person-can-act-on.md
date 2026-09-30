# 0062. The plan is one pill, and shows only what a person can act on

Status: accepted; amends ADR 0052 and ADR 0053 (how the plan is shown); the verdict flag and its reason removed by ADR 0063

## Context

The plan was drawn in the conversation, after the latest request. Long turns
pushed it out of view, so its changes happened where nobody was looking. It
showed eight states, the working model's claim beside the reviewer's verdict,
with the criterion, evidence and the reviewer's reason under each item. The
header counted only items the reviewer had verified, so it read `0/6` while the
assistant had finished five. The current item looked the same as one not
started, because the row was styled from the reviewer's status alone.

Zhiyin is for people who do not follow how work is checked. They need to know
where the work stands and whether anything needs them.

## Decision

1. **One pill above the conversation, outside its scroll.** It shows `Plan
   n/N` and the current step. It opens into the steps in a fixed order and
   closes on Escape or a press outside it (ADR 0055). It is hidden when there
   is no plan. The plan is no longer drawn in the timeline.
2. **Five marks, from the two fields already kept:**
   - Skipped: the assistant cancelled it.
   - In progress: the assistant is working on it.
   - Needs a look: the reviewer did not verify it, and the assistant is not
     redoing or skipping it.
   - Done: the assistant says done, or the reviewer verified it, or is checking
     it.
   - To do: anything else.
3. **The reviewer's verdict is shown only when it fails.** Verified, checking
   and "couldn't judge" all read as Done. A "Needs a look" step gives the
   reviewer's reason in the list, and the pill carries a dot. Nothing else of
   the criterion, evidence, steps or verification is shown.
4. **`n` counts done and skipped steps.** The pill says "Plan complete" when
   every step is one of those.

The stored plan, the judge and the notices to the working model are unchanged.

## Assumptions

- A step the assistant says is done, and the reviewer has not yet finished
  checking, is right to show as Done. The reviewer runs after claims and at the
  end of the turn; a step it then does not support moves to Needs a look.
- "Couldn't judge" is a failure of the reviewer, not a finding about the work,
  so it is not shown. This is the one place a step reads as Done with nothing
  said about why no verdict came. If that misleads, it gets its own mark.
- The plan holds at most eight items, so the list needs no windowing.

## Disagreement recorded

Hiding the verdict trades some of ADR 0052's rule that the assistant's claim is
never read as an assessment. Done means "the assistant says done and nothing
found it lacking", not "checked". The person asked for this to keep the plan
quiet; the failure case is still shown.

## Consequences

- The plan is not part of the conversation record. It is read from the task, so
  it survives a restart as before.
- A plan still lags when the working model forgets `update_plan`. Moving the
  current step from the plan item each call names is left for a later change.

Named tests are listed in the renderer architecture document under this ADR's
number.
