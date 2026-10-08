# 0013. Long work stops at a checkpoint the person renews, and the working model keeps its own plan

Status: accepted

## Decision

- **A stretch of work stops before its next action** when it reaches 24 tool
  rounds, 30 minutes, or USD 10 of provider-reported cost. Tokens are counted
  and shown, never limited. When the provider reports no cost, rounds and time
  are the bounds.
- **The person decides with one question.** It names the limit reached in
  plain words, and what repeated if Zhiyin saw the work repeat itself, and
  offers Pause or Continue. Continue grants twice the rounds of the stretch
  that ended (24, then 48, then 96), restarts the time and cost limits, and
  tells the model with a notice. Pause runs nothing that was proposed: it
  allows one request with no tools, asking for a report of what was done,
  where things stand and what remains, and the turn ends as paused with that
  report.
- **A quiet correction is not work.** A round whose calls were all corrections
  answered to the model alone (ADR 0014) is not counted.
- **A loop is named once it is a loop.** When the same call gives the same
  whole answer three times in a row, or the same tool fails the same way three
  times in a row, the model gets one `loop` notice. A successful change to the
  workspace starts the count again. At most two notices a turn.
- **The working model keeps its own plan.** `update_plan` replaces the whole
  list, each item a title and a status: pending, in progress, done or skipped,
  at most eight. An update is corrected rather than refused for its content:
  only the first item in progress stays so, untitled entries are dropped, and
  the list is cut to eight. The model is shown the open items at the start of
  a turn, reminded once before finishing a turn with items still open, and
  asked whether its step has finished after four rounds of work with no
  update.
- **Nothing judges the plan.** No other request writes, checks or grades it.
  The window shows it as progress.

## Why

Long autonomous work has to give control back to the person regularly without
failing: a turn that dies at a fixed guard loses its place and reads as broken.
Cost and time protect the person; rounds stand for "has the person looked at
this lately". A person who chose Continue has looked, so the next question
comes later.

A token limit measures how long the conversation is, not how much work was
done: every request is counted whole, so a long conversation reaches any total
by re-reading itself.

A plan's job here is to show a person where the work stands. Asking the model
to cite evidence for each step leads it to invent citations; refusing an update
throws away the valid progress in it; and a judge per item is another request
on the person's own key.

## Rejected

- A fixed round guard that fails the turn.
- A token limit on the turn.
- The same allowance on every Continue: the person is asked again after the
  same short stretch, learning nothing new.
- A separate planner request, criteria per item, and a judge that checks them:
  extra requests on every turn, and a wrong tick in a progress list costs less
  than a second model's verdict.
- Counting a call repeated between other work as a loop: that is checking, not
  circling.

## Assumptions

- Provider-reported cost, where it exists, and elapsed time measure what a
  limit is for.
- The quiet-correction limit bounds the uncounted rounds, so a turn stays
  bounded.
- The working model reports its progress faithfully enough to display.
- Four rounds without an update catch a lagging plan within a step or two.
