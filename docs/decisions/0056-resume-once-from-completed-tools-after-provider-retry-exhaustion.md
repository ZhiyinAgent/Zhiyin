# 0056. Resume once from completed tools after provider retries are exhausted

Status: accepted

## Context

ADR 0049 retries a model request before output and restarts an interrupted
stream while the caller can withdraw it. A provider can still stop responding
after those bounded retries. In a longer task, that leaves completed actions
saved but the person facing a fragment of a sentence and a provider error.

Assumptions this decision depends on:

- No tool runs until its model round has completed. An interrupted round has
  made no new change outside the conversation.
- Completed tool results are recorded in model history before the next round.
- A single new request after retry exhaustion is a reasonable cost when work
  has already completed; repeated attempts without a bound are not.

## Decision

Keep ADR 0049's client retry and restart rules. If a retryable connection
failure escapes them after this turn has completed a tool round, withdraw the
failed round's partial answer, tell the person that work is continuing, and
send one new model request from the recorded tool results. A marked recovery
notice tells the model to continue from those results and not repeat completed
actions. If this request also fails, stop with a plain message that the
completed actions are saved and a follow-up can continue the work.

The turn makes this new request at a completed tool boundary. It does not
repeat an individual request or run any tool automatically because a prior
request failed.

## Consequences

- A transient provider outage can cost one more model request after the
  client's own retry allowance, with the same work budget still applying.
- The model may itself propose an action it has already done. The recorded
  result and the recovery notice discourage that; normal inspection and
  approval still govern any proposal.
- A failed turn after the bounded continuation remains honest about partial
  success and gives the person a clear way to continue.

The named regression is `continues from a completed action after an upstream
idle timeout`.
