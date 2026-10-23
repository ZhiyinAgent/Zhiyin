# 0018. Long work stops where the person says, and the working model keeps its own plan

Status: accepted

## Decision

- **A stretch of work stops before its next action** when it reaches its
  rounds, minutes or cost. These are settings: 50 tool rounds, 30 minutes,
  USD 10 and CNY 70 until the person changes them, from five rounds, five
  minutes, USD 1 and CNY 5 at least to a thousand rounds, a day, USD 1,000
  and CNY 7,000 at most. Tokens are counted and shown, never limited.
- **Cost counts what the provider reports, and what Zhiyin estimates.** A cost
  the provider does not report is estimated from the shipped price list (ADR
  0015). Each currency counts against its own limit: US dollars against the
  USD limit, yuan from a mainland China platform against the CNY limit. A
  request with no known price adds nothing; for work made only of such
  requests, rounds and time are the bounds.
- **The person decides with one question.** It names the limit reached in
  plain words, and what repeated if Zhiyin saw the work repeat itself, and
  offers Pause or Continue. Continue grants twice the rounds of the stretch
  that ended (50, then 100, then 200 with the default), restarts the time and
  cost limits, and tells the model with a notice. Pause runs nothing that was
  proposed: it allows one request with no tools, asking for a report of what
  was done, where things stand and what remains, and the turn ends as paused
  with that report.
- **A quiet correction is not work.** A round whose calls were all corrections
  answered to the model alone (ADR 0010) is not counted.
- **A specialist keeps its own fixed limits** (ADR 0019); these settings do
  not reach it.
- **A loop is named once it is a loop.** When the same call gives the same
  whole answer three times in a row, or the same tool fails the same way three
  times in a row, the model gets one `loop` notice. A successful change to the
  workspace starts the count again. At most two notices a turn.
- **The working model keeps its own plan.** `update_plan` replaces the whole
  list, each item a title and a status: pending, in progress, done or skipped,
  at most twenty. An update is corrected rather than refused for its content:
  only the first item in progress stays so, untitled entries are dropped, and
  the list is cut to twenty. When the plan does not fit in a short request
  that names an action, the items nearest the step in progress are kept rather
  than the plan dropped. The model is shown the open items at the start of a
  turn, reminded once before finishing a turn with items still open, and asked
  whether its step has finished after four rounds of work with no update.
- **Nothing judges the plan.** No other request writes, checks or grades it.
  The window shows it as progress.

## Why

Long autonomous work has to give control back to the person regularly without
failing: a turn that dies at a fixed guard loses its place and reads as broken.
Cost and time guard against runaway work; rounds stand for "has the person
looked at this lately", which only the person can answer, so they set how
often to be asked. As each product's source or documentation said on
2026-10-17, Copilot in VS Code pauses at 50 requests and Devin Desktop at 40;
Cursor, Cline, Codex and Claude Code do not pause on a count. A person who
chose Continue has looked, so the next question comes later.

A cost limit that counted only reported cost would not bound work on a lab's
own API, which reports none: the estimate from the price list stands in for
it, in the currency the person's bill uses.

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
- Fixed limits the person cannot change: the right interval between check-ins
  differs by person and by work.
- Turning the round limit off entirely: cost and time would remain, but a
  person who wants to look in regularly would have no way to say so.
- Converting estimated costs to one currency for one limit: a second estimate
  (an exchange rate) on top of the first.
- The same allowance on every Continue: the person is asked again after the
  same short stretch, learning nothing new.
- A separate planner request, criteria per item, and a judge that checks them:
  extra requests on every turn, and a wrong tick in a progress list costs less
  than a second model's verdict.
- Counting a call repeated between other work as a loop: that is checking, not
  circling.

## Assumptions

- Provider-reported cost, or an estimate from a price list that says its date,
  and elapsed time measure what a limit is for.
- A thousand rounds, a day, USD 1,000 and CNY 7,000 are the most anyone needs
  between check-ins; five rounds or five minutes the least that is still work.
- The quiet-correction limit bounds the uncounted rounds, so a turn stays
  bounded.
- The working model reports its progress faithfully enough to display.
- Four rounds without an update catch a lagging plan within a step or two.
