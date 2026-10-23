# 0019. Specialists run in the background as child runs, each with its own budget, and hand back one report

Status: accepted

## Decision

- **A specialist is a child run of the turn that delegated to it.** A plugin
  defines it: a name, a description, instructions, and optionally the tools it
  may use and whether it only reads. It runs on the conversation's model with
  those instructions and the parent's tools narrowed by its definition. Its
  task is Zhiyin's first message to it, a `delegation` notice after its
  instructions, so every request it makes repeats the same start. It is stored
  on the conversation with its parent, its definition, its task, its status
  and its report.
- **A specialist hands back one report**, written in Markdown, with the
  outcomes of its calls. Its instructions say what the report should hold; the
  person reads it as written, and the main agent receives it fenced in a
  `handoff` notice. A finish without a usable report is answered, so the
  specialist can send it again, up to three times before the run fails.
- **Delegating does not block.** `delegate_specialist` starts the child and
  answers at once, and several can run at the same time. The handoff arrives
  as a notice to whichever turn is live when the child settles: the same
  turn's next round, or a turn woken for the conversation if the parent has
  already finished. A finished turn leaves its specialists running, and the
  person can carry on with the conversation meanwhile.
- **Delegation grants no authority.** Every call a specialist makes goes
  through the ordinary inspection and permission path. Approvals from
  concurrent work are shown one at a time, in the order they arrive.
  Cancelling the conversation cancels every specialist under it.
- **Bounded in depth and width.** A specialist is never offered
  `delegate_specialist`. A turn may delegate to three specialists, and a turn
  woken by a handoff counts those already delegated.
- **Each run has its own work budget**: 40 tool rounds, 30 minutes, USD 10 and
  CNY 70. Its use counts toward the conversation's usage, not toward the main
  turn's limits, and the main turn's limits do not stop it.
- **Its requests are held to the conversation's context budget**, sized as a
  turn's are (ADR 0017): from the provider's count of the last request and the
  reasoning sent back. What a tool answers is cut to the share one result may
  take. A refusal as too long also lowers the window planned with.
- **At a limit it is asked for its report.** When its work budget is spent,
  when its next request would pass the context budget, or when a request is
  refused as too long, it gets a `wrapUp` notice and one request with only
  `finish_specialist` on offer, to report what it has and what it did not
  finish. That request is fitted to the budget: its estimated size scaled by
  how far the provider's last count, or the size a refusal stated, ran above
  the estimate of its messages, as if the tools that request carried cost
  nothing. Its oldest results are saved and set aside, one at a time, until it
  fits, so the newest are the last to go. Refused as too long, it lowers the
  window as a turn's does, is fitted again and is sent again once, if that set
  anything aside. Once asked to report, it has one try; one that does not
  report is interrupted.
- **Its rounds are asked like a turn's**: with the conversation's reasoning,
  the conversation as their session, and marks for what the next request can
  reuse. Its tools are offered with the same `purpose` argument a turn's are.
- **A read-only specialist is offered only tools marked as reading** (ADR
  0009): Zhiyin's own read tools, the tools a connection Zhiyin ships marks as
  reading, and the remote tools an activated plugin declares read-only. A call
  outside that list is refused before inspection.
- **A specialist knows it works out of sight.** It is told that nothing it
  reads or writes is shown to the person, and it is not offered
  `close_document`.
- **A restart interrupts a running specialist.** It is marked interrupted,
  never resumed or shown as still running.

## Why

A specialist takes one narrow part of a task, with instructions written for
that kind of work, and returns a bounded handoff. Running it in the background
lets the person and the main turn carry on meanwhile, and lets several
specialists work at once; waiting on each in turn would make delegation slower
than doing the work directly.

One report in the specialist's own shape fits its work: a fact-checker and a
code reviewer report different things, and their instructions already say
what. Fixed fields make every specialist write the same shape, are read by the
main agent as one text anyway, and lose a run for one field filled badly.

A specialist cannot ask the person to continue. If it shared the main turn's
budget, a main turn running low would stop it and discard what it found. Its
own budget, with a final request to report, keeps its findings. The work
budget counts calls and spend, not the size of the request, so a specialist
could also grow its conversation past the model's window, and the request
that failed would be the one that lost the work; asking for the report before
the context budget is passed keeps what it found.

## Rejected

- Sequential, blocking delegation: the parent waits, and so does the person.
- One budget shared by the parent and its children: the child is stopped by
  limits it cannot renew, and loses its work.
- Nested delegation: an execution tree nobody can review.
- Several approval prompts shown at once: one at a time, in arrival order,
  keeps each decision readable.
- A handoff of fixed fields (summary, findings, recommendations, limitations),
  each checked: the main agent reads them as one text, and the check turns
  away a report for one missing list.
- Condensing a specialist's conversation as a turn's is condensed: a
  specialist works on one narrow task, and its report is the condensed form.
- Failing the run when the request grows too long: its findings are lost.
- Setting aside every result before the report: a model writes from what its
  request holds, so the newest results are kept as long as the budget allows.
- Resuming a specialist after a restart: needs durably scheduled work, not
  only a durable record.
- Trusting a server's read-only annotations to choose a read-only specialist's
  tools (ADR 0009).

## Assumptions

- The conversation's selected model suits its specialists.
- A specialist's instructions say what its report should contain.
- The conversation's context budget, built for turns, also suits a
  specialist's requests.
- A model asked to report with nothing else on offer writes its report in one
  try often enough that one try suffices.
- Total spend is bounded by each specialist's own limits and the three per
  turn, not by the main turn's limits.
