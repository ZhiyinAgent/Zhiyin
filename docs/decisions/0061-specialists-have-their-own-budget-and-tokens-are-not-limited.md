# 0061. Specialists have their own budget, and tokens are not limited

Status: accepted. Supersedes the token limit of 0038 and the shared ledger of
0044.

Date: 2026-09-30

## Context

The Continue prompt appeared after 6 to 8 tool rounds, well under the limit of
24, in a conversation using 40% of a 262k context window. The work ledger added
each request's provider-reported total tokens, prompt included, into one
500,000-token limit. A conversation of about 105k tokens re-reads that history
every round, so five requests reached the limit: the total measured how long the
conversation was, not how much work had been done.

A specialist shared that ledger and could not ask anyone to go on, so it stopped
itself when the main task's limit was reached, marked interrupted, and its
findings were discarded. Its tokens, read against the same history, used the main
task's allowance up faster. ZCode gives each subagent its own optional turn limit
and no shared token or cost budget; minimax-code bounds only its goal-verifier
child, and sets no limit on other delegated subagents.

Assumptions this decision depends on:

- Provider cost, where reported, and elapsed time measure what a limit is for;
  the tool-round limit bounds repetition when cost is not reported.
- The context window has its own guard (compaction), so a limit on tokens read
  is not needed to keep a request within the model's window.
- A specialist that can report what it has found loses little by being asked
  to stop.

## Decision

- The work ledger has no token limit. Tokens are still counted, for the
  description of where work stands. The limits are 24 tool rounds, 30 minutes
  and USD 10 of provider-reported cost.
- A specialist has a ledger of its own: 40 tool rounds, 30 minutes and USD 10.
  Its usage is still recorded for the usage display, but does not count
  towards the main task's limits, and the main task's limits do not stop it.
- When a specialist reaches its own limit it gets one more request, with only
  `finish_specialist` on offer, asking it to report what it has and list what it
  did not finish. A specialist that does not report then is interrupted.

## Consequences

- A specialist can spend up to USD 10 and 30 minutes per run, and three may run
  in a turn, so the main task's limits no longer bound total spend. Each
  specialist's own limits and the delegation width of three do.
- A provider that reports no cost leaves the tool-round and elapsed-time limits
  as the only bounds on a conversation.
- A specialist asked to wrap up costs one extra model request.
