# 0011. A failed model request is retried unseen, restarted openly, and resumed once from finished tools

Status: accepted

## Decision

- **The model client alone decides when a request is sent again.** Before it
  has passed anything on, it retries a retryable failure silently: at most 5
  attempts and 120 seconds of waiting in total. Each wait is what the provider
  asks for, up to 60 seconds, or else a random wait below a ceiling that
  doubles up to 30 seconds. The window shows each wait with a countdown. A
  failure that would fail the same way again (credentials, credits,
  moderation, an unknown model, a request too long) is never retried.
- **Once output has been passed on, only a caller that can take it back gets a
  restart.** A request marked restartable is started again at most 3 times,
  and each restart tells the caller that what it received is void. Any other
  caller gets the failure.
- **The answer is shown 5 seconds behind the model.** The model is read at full
  speed; only the display lags, and a finished round shows everything at once.
  A restart while the text is still held back goes unseen. After text has been
  shown, the restart is open: the shown text is withdrawn and the working note
  says the answer is starting again. An answer is never continued from its
  partial text.
- **A turn that has finished tools is resumed once.** When the client gives up
  on a dropped connection and the turn has already completed a tool round, the
  turn withdraws the failed round's partial answer and sends one new request
  from the recorded results, with a notice not to repeat finished work. If
  that fails too, the turn stops, saying the completed actions are saved and a
  follow-up can carry on.
- Every retry and restart is recorded on the round's model response, with its
  cause, its wait, and how much shown text it withdrew.

## Why

Tool calls are assembled while an answer streams and run only after it ends,
so a failed stream has run nothing and sending it again repeats no effect.
Brief capacity errors are routine when one model is served by many upstreams,
and a turn that failed on one would throw away the work before it.

Continuing from partial text would mean sending it back for the model to
extend, which several current models refuse, and partial reasoning cannot be
replayed at all. The display lag trades a short wait for the first words
against text that appears, vanishes and is written again.

## Rejected

- Continuing from the partial answer: refused by models that do not accept a
  prefilled assistant message.
- Retrying only before any output: the common mid-stream failure would end the
  turn.
- Showing text at once and restarting visibly on every failure: withdraws text
  a person may be reading, for failures a short delay hides.
- The turn retrying as well as the client: two owners of one policy.
- Running tools while a round still streams: a restart would then repeat
  effects.

## Assumptions

- No tool runs before its round has finished streaming.
- Retryable failures mostly arrive within seconds of the first output.
- A person minds a few seconds before the first words less than text that is
  shown, withdrawn and written again.
