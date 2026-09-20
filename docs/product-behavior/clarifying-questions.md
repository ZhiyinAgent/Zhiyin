# Clarifying questions

## Purpose

A clarifying request lets the model pause a turn when a missing choice would
materially change the work. It gives the person a small structured question set
instead of making the model guess or forcing the person to encode answers in a
new chat message.

## Experience

- A request contains one to three questions. A question can offer mutually
  exclusive choices, accept a short written answer, or offer both through a
  clearly labelled “Something else” field.
- The request appears beside the composer, in the same decision area as an
  approval, but it is not styled as permission and never implies risk or
  authority. It never makes that area scroll: the request shrinks to the space
  available and its own question area scrolls instead.
- A request with several questions presents one question at a time, with the
  step position and answered progress in the header, and Previous and Next
  moving between them. Returning to a question shows the saved answer.
- The last question leads to a review of every question and its answer, where
  any answer can be changed before sending. A single-question request has no
  review step and sends directly.
- The turn pauses until all required answers are supplied. The person can answer
  once or stop the task; stopping stays available at every step.
- After submission, the questions and answers remain as a compact conversation
  record. The model receives the answer as the result of the exact tool call
  that asked it.

## Contract

Each request and question is bounded. Question ids and option ids are unique.
A choice must name an offered option; written text is accepted only when the
question permits it. Every question is required in this increment so the model
never resumes with an ambiguous partial response.

## Invariants

- Asking changes no file, account, or external service and therefore does not
  enter the permission engine. Named regression: `advertises clarification
  without a workspace and validates each response`.
- A response resumes only the task and request that are currently waiting for
  it. Named regression: `pauses for the exact clarification response and gives
  it back to the model`.
- Unknown options, disallowed text, duplicate questions, and omitted answers are
  rejected while the request remains answerable. Named regression: `rejects an
  invalid clarification without consuming the request`.
- Cancellation settles the wait and no late response can restart the turn.
  Named regression: `cancels a turn waiting for clarification without accepting
  a late answer`.
- The renderer labels each question, supports keyboard-native controls, prevents
  duplicate submission, and reports a send failure in place. Named regression:
  `answers several clarifying questions once`.
- Moving between questions and returning from the review keeps every answer
  already given. Named regression: `keeps clarifying answers when moving
  between questions and back from review`.

## Limits

Questions do not grant permission. If an answer leads to a consequential action,
that action still enters the ordinary permission flow with its own exact review.
