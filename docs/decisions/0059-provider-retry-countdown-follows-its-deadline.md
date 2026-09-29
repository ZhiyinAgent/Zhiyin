# 0059. Provider retry countdown follows its deadline

Status: accepted

## Context

The provider client already used a capped, jittered exponential wait or a
provider-supplied Retry-After before retrying a transient failure. The
conversation displayed the initial delay as fixed text, so a note saying
"in 8 s" could remain on screen after eight seconds had passed. A stream
restart could also add its restart count to the later retry's attempt count
and display an attempt greater than its stated maximum.

Assumptions this decision depends on:

- A wall-clock deadline can be sent with the working phase and recalculated
  when the renderer resumes after being backgrounded.
- The gap between publishing the retry event and starting the provider wait is
  small compared with the displayed whole-second precision.
- Once the wait expires, the next request may still be connecting or generating;
  the interface must not keep displaying a positive wait or claim it succeeded.

## Decision

The working phase carries a retry deadline and count separately from its note.
The renderer computes remaining whole seconds from that deadline, updates the
display while the phase remains active, and removes the number at zero. It
continues to show that a retry is under way until the round makes progress or
settles. A stopped or completed turn clears the phase and the timer.

The model client retains its exponential ceiling with full jitter and honors
Retry-After. Silent attempt numbering counts silent attempts, not prior stream
restarts, so the displayed count remains within its stated limit.

## Consequences

- A backgrounded or reopened conversation resumes the countdown from the
  deadline rather than restarting a local timer.
- The displayed second is approximate to the event and storage latency; it is
  a countdown to the scheduled retry, not a promise of provider response time.

Named regressions: `counts down the provider retry from its saved deadline`,
`publishes the provider retry deadline and which attempt is next`, `keeps the
next attempt within its stated maximum after a restart`, and `restores a retry
deadline and rejects one that cannot drive a countdown`.
