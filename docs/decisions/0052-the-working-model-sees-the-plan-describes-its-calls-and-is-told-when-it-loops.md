# 0052. The working model sees the plan, describes its own calls, and is told when it loops

Status: accepted; amends ADR 0008 and ADR 0046

## Context

A separate call writes each turn's plan, and a judge checks each item's
criterion. The working model never saw the plan: the system prompt said the
interface showed it separately. Criteria it was never shown were reported
unresolved, which read as the model failing.

Before every built-in tool call, another model call wrote the action's title
and description and guessed which plan item it served. The approval prompt
waited for that call, and each guessed link started a judge call after the
action. A 20-call turn made about 20 labelling calls and up to 20 judge
calls, one after another.

Nothing noticed a model repeating itself. A model listing the same folder over
and over ran until the work budget stopped it and asked the person
"Continue?", with nothing to judge the question by.

**Assumptions this decision depends on** (revisit it if any changes):

- A model can fill two extra optional arguments on every call reliably enough
  that a missing one is the exception. When it doesn't, nothing breaks: the
  action is named in the background and left unlinked.
- The judge stays another call (task 23). Progress the working model reports
  is its claim and never becomes a verdict.

## Decision

1. **The plan is shown.** The first request of each turn carries a `plan`
   notice with every item's id, criterion, progress and verdict. With items
   open, it is sent again once ten rounds pass without `update_plan`, worked
   out from the saved history so a replay sends the same notices.
2. **Every tool call describes itself.** Every tool is offered with optional
   `purpose` and `plan_item` arguments, taken off before the tool sees its
   input. A tool whose own input uses either name keeps it and gets neither.
   The purpose is the action's description and the approval's reason; the
   plan item links the action. A call without a purpose is shown at once from
   what the code knows, and named by a model in the background. That call no
   longer guesses a plan item, and no criterion is judged after an action.
3. **`update_plan` reports progress.** Progress is `pending`, `in_progress`,
   `done` or `cancelled`, kept apart from the verdict:
   - done needs this turn's call ids, each with what it shows;
   - cancelled needs a reason, and a cancelled item is not judged;
   - criteria the model adds are marked as the assistant's and judged like the
     others, up to eight items in all.

   The schema has no field for a verdict.
4. **A loop is named.** Two signals send one `loop` notice:
   - the same tool, same input and same outcome three times;
   - the same tool failing the same way three times in a row.

   A workspace change that succeeded resets the count. At most two notices a
   turn; the work-budget question then says what was repeated.

## Consequences

- A turn of calls that describe themselves makes no model call between
  actions, and an approval appears as soon as the call is checked.
- Each request carries two short properties per tool and the `update_plan`
  definition, all in the cached prefix. The meaning of the two arguments is
  said once in the system prompt rather than on every tool.
- The plan card shows both sides, for example "Done (the assistant says) ·
  Assessed as done".
- Task 23 builds the judge on this:
  - the evidence record per item, from the actions linked to it;
  - a judge started by a claim of done;
  - typed verdicts.
- The model history, as saved, is the record of every notice Zhiyin sent. No
  separate evidence entry is kept for each.

Named tests are listed in the agent-loop, session and renderer architecture
documents under this ADR's number.
