# 0049. A failed model request is retried before output and restarted after

Status: accepted

## Context

Zhiyin never retried a model request. One 429, 503, dropped connection or
error chunk inside the stream ended the turn as failed, throwing away every
tool round that had already succeeded. OpenRouter routes across several
upstreams, so brief capacity errors are routine, and "try again shortly" in the
middle of a long task reads to a non-technical person as the app breaking.

The model client's notes deferred retrying to "a separate product decision",
because a repeated request costs money and, once tools exist, could repeat an
effect. This is that decision. Two facts make it safe to take now:

- Tool calls are assembled while the answer streams and run only after it ends.
  A failed stream has therefore run nothing, and repeating it repeats no effect.
- The model client's error classification marks each failure retryable or
  permanent, from OpenRouter's typed error. Authentication, credits,
  moderation, an unknown model and a real context overflow are not retried.

The hard part is a failure after text has been shown. Continuing from the
partial text means sending it back as a final assistant message for the model
to extend. Anthropic's current models refuse that with a 400 ("do not support
prefilling assistant messages", Claude API errors page, read 2026-09-23), and
partial reasoning cannot be replayed at all. So continuation would be a
per-model feature with a restart as its fallback anyway.

**Assumptions this decision depends on** (revisit it if any changes):

- No tool runs while its round is still streaming. Starting tools during the
  stream (as ZCode does) would make a restart repeat effects.
- Retryable failures mostly surface within seconds of the first output, so a
  short delay before showing text absorbs most of them.
- A person tolerates a few seconds before the first words appear better than
  text that is shown, withdrawn and rewritten.

## Decision

A retryable failure is retried unseen until anything has been shown, and the
round is restarted openly after that. It is never continued from the partial
text.

- **The model client owns when a request is sent again.** Before it has passed
  any event on, it retries silently: up to 5 attempts within 120 s, waiting the
  provider's Retry-After (capped at 60 s) or else 1 s doubling to 30 s with full
  jitter, and announcing each wait as a `retrying` event. Every caller benefits:
  turns, auxiliary work, specialists.
- **After events were passed on, only a caller that can take them back gets a
  repeat.** It marks its request `restartable`; the client then starts again at
  most 3 times, announcing each with a `restarting` event that voids what the
  caller received. Fewer than silent retries, because each one pays for the
  output again. A caller that did not mark its request gets the failure.
- **The turn shows text 5 s behind the model.** The model is read at full
  speed; only the reveal lags, and a round that ends releases everything at
  once. Text still held back was never saved or shown, so a restart inside that
  window is unseen.
- **After text has been shown, a restart is open**: the turn withdraws the shown
  text from the conversation, the working note says the answer is starting
  again, and the new answer streams into the same message.
- Every retry and restart is recorded against the round's model response, with
  its cause, its wait, and how much shown text was withdrawn; a restart nobody
  saw is recorded as silent.

One owner for the policy: the turn does not retry anything itself. It only
takes back what it received, which is the part only it can do.

Alternatives, briefly: continuing from the partial text (refused by current
Anthropic models, above); retrying only before output, as MiniMax does
automatically (leaves the common mid-stream failure fatal); showing text
immediately and restarting visibly on every mid-stream failure (withdraws text
a person may already be reading, for failures a short delay would have hidden).

## Consequences

- A brief provider problem no longer fails a turn. Waits count toward the
  turn's elapsed-time budget; discarded output counts toward its tokens, since
  the provider bills it.
- The first words of every answer appear up to 5 s later than they could, and
  text on screen trails the model by that much. A round that only calls tools
  is not delayed, and a finished round never waits. The delay is one named
  value, and the recorded retries show whether it absorbs failures.
- A long answer that fails near its end is written again from the start.
  Continuation can be added later only for models proven to accept a prefill.
- A stalled stream is detected only after the stall timeout, by which time its
  text has been shown, so stalls always restart visibly.
- Text still held back when the person stops the turn is dropped, not shown:
  a stopped turn writes nothing more to the conversation (ADR 0012), and that
  text had not been shown to anyone.
- Specialists and auxiliary work get the silent retry only; a failure after
  they have received output still fails them, as before.
- Starting tools while a round streams is foreclosed unless this is revisited:
  a restart would then repeat effects.
