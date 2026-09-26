# 0053. One judge request assesses the plan from this turn's evidence, and says which of three things its verdict is

Status: accepted; amends ADR 0008, ADR 0046 and ADR 0052

## Context

At the end of a turn, the judge made one call per open item, one after another.
Each call saw the criterion, the final answer, and every action in the
conversation, earlier turns included. Each result was cut to 600 characters,
then the whole list to 4,000, keeping its start and end. In a 20-call turn it
saw about the first and last three calls, and the calls that did the work were
usually in the middle. It never saw the person's request, and it could not look
anything up.

A failed judge call returned nothing, and the item then read the same as one
judged not done. The person could not tell "the evidence was cut out" or "the
request failed" from "the work is missing".

ADR 0052 gave the working model the plan, a way to claim items done citing
calls, and a `plan_item` argument on every call. Nothing used the claim yet.

Separately: `TurnRecords` read a task from the app, and the app commits a write
only once it is saved. Work in the background (ADR 0052's action labels) could
therefore build on a task from before a write still being saved. Whichever save
finished last undid the other.

**Assumptions this decision depends on** (revisit it if any changes):

- 15% of the conversation's budget target is enough to show the calls that
  matter to the items being judged, most turns. What does not fit is named, and
  the judge can open it.
- The same model can judge the work usefully. Most of the value is in the
  separate request: its own instructions, no memory of the worker's reasoning,
  and tools to check for itself. A different model would add less, and each
  person keeps one model to configure, for ease of use and understanding.

## Decision

1. **The evidence is this turn's calls, kept by the code.** Each call is
   recorded as it runs: the tool, its input without `purpose` and `plan_item`,
   the item it named, and the result as the working model was sent it. No model
   builds the record.
2. **The judge runs at two points only.**
   - When `update_plan` claims items done, those items show as being checked,
     and one request judges them behind the turn. The working model is not held
     up.
   - At the end of the turn, after any claim still being judged, one request
     judges every item still open. Cancelled items are not judged.

   No judge request follows an action.
3. **What the judge is given:**
   - the person's request;
   - each item's criterion;
   - the worker's progress and citations, labelled as a claim;
   - the calls, cited ones first, then those linked to the items, then the
     final answer, then the rest.

   A call is shown whole or not at all, within 15% of the budget target. The
   calls left out are named, with `open_call` to open them.
4. **It can check for itself, read-only by construction.**
   - It is offered `read_file`, `list_directory`, `search_files`, and
     `read_image` when the model accepts pictures, plus `open_call`.
   - Each of its calls must be a built-in tool, inspect as read access, and be
     allowed by the permission engine without asking. Anything else is refused
     to the judge, and the person is never asked.
   - Up to five rounds of reading, then it must answer. Its reads are not
     actions of the conversation.
5. **One answer per request, validated.** `record_verdicts` holds one entry per
   item:
   - an id it was asked about;
   - `verified`, `not-verified` or `couldnt-judge`;
   - a reason;
   - the call ids relied on.

   An id answered twice counts as unanswered, and an id not asked about is
   ignored. An unreadable answer is asked for once more. An item left out gets
   one request of its own. Room to answer is 800 tokens plus 150 per item, with
   the least thinking the model allows.
6. **Typed verdicts, never swallowed.**
   - `verified` keeps the calls it relied on.
   - `not-verified` keeps what is missing.
   - A failed request, or an answer that still cannot be read, is
     `couldnt-judge` with its reason. It is shown as that, never as not
     verified.
7. **A gap goes back to the model.** A not-verified verdict from a claim reaches
   the next request as a `gaps` notice. Each item is named at most once a turn.
8. **A write still being saved is what the next read builds on.** `TurnRecords`
   keeps each task's latest write until its save finishes. Work in the
   background then never undoes the turn's writes, or the turn its.

## Consequences

- A turn makes at most one judge request per claim, plus one at its end, each
  with up to five reads. Before, it made one request per open item.
- The plan card shows both sides: "Done (the assistant says) · Checking", then
  "Assessed as done", "Not verified" or "Couldn't judge", each with the
  judge's reason.
- An item judged not verified at the end of a turn shows as not verified with
  its reason, where before it went back to open with nothing said.
- Earlier turns' actions are no longer evidence. A criterion that rests on
  them is checked by the judge reading the workspace.
- The judge's reads are not recorded as actions. Its reason says what it
  opened.
- The audit log gains no entry kind for the judge.

Named tests are listed in the agent-loop, session and renderer architecture
documents under this ADR's number.
