# 0029. Tool-round budget renews or pauses with a report

Status: accepted

## Context

The agent loop had a fixed guard of twenty-four tool-request rounds. When the
next model response proposed another action, the loop failed the turn and told
the person to send another message. That preserved completed effects but lost
the active model protocol, made ordinary long work look broken, and gave the
person no clean way to stop after receiving a handoff.

**Assumptions this decision depends on:**

- Twenty-four consecutive tool rounds remains a useful point to put a person
  back in control; it is not a claim about cost, elapsed time, or token usage.
- Completed action records and conversation messages contain enough durable
  evidence to rebuild model context at a continuation boundary. Missing detail
  must be read again rather than inferred.
- A pause report is informational and grants no authority for another action.

## Decision

Treat twenty-four tool rounds as a renewable tranche. If the next model
response proposes another tool call, pause on a core-owned request id and offer
Continue or Pause. Invalid, stale, cross-task, duplicate, and post-cancellation
answers cannot resume the turn.

Continue refreshes the counter and keeps the same active turn. Before executing
the pending proposal, rebuild the request from durable conversation and action
evidence and run the normal context-compaction check. Add a trusted control
message recording that the person chose to continue. The choice can recur for
as many tranches as the person authorizes.

Pause does not execute the pending proposal. It permits exactly one additional
main-model request with no tools advertised and a trusted instruction to report
completed work, current state, remaining work, blockers, and the safest next
step, then stop. A usable report completes the turn as `Work paused`; a missing
report interrupts it rather than pretending the task finished.

A restart still interrupts any pending in-memory continuation. Restoring the
prompt itself is useful for truthful history, but fabricating the lost
continuation would risk repeating uncertain effects.

## Consequences

Long work no longer fails merely because it crossed an implementation guard.
People periodically regain control and can receive a bounded handoff without
allowing one more effect. Continuations re-enter the existing compaction path,
so repeated tranches do not require an ever-growing raw provider transcript.

This does not finish the overall work-budget design. Cost, elapsed-time, token,
delegated-work, and restart-resumption limits remain tracked separately.
