# Quizzes

## Purpose

A quiz is a guided learning exchange that lets a person work through several
scored questions without translating a structured exercise into chat prose.
Each question offers several answers and may require one or several selections.

## Experience

- The model creates a quiz only through the quiz tool. JSON or Markdown in an
  ordinary message remains text.
- A pending quiz appears in the conversation's scroll surface and pauses the
  turn. It temporarily replaces the composer because the quiz itself is the
  active input surface. The quiz presents exactly one question at a time rather
  than exposing the whole exercise as a form.
- Single-answer questions use radio buttons. Multiple-answer questions use
  checkboxes and say that more than one answer may be selected.
- Checking an answer locks that question and immediately says whether the exact
  selection was correct. It always shows the model-supplied explanation.
- Colour has one meaning per grading outcome: green is correct, red means the
  selection contains an incorrect answer, and amber means a multiple-answer
  selection contains only correct answers but missed at least one. The result
  is also announced in text for people who do not perceive colour.
- Next and Previous move through the questions. Returning to a question shows
  the saved selection and feedback; a checked answer cannot be silently
  rewritten.
- After the final checked question, the result screen shows the score and one
  marker per question. The person may review the attempt, start again with a
  clean slate, or finish the quiz. Only Finish quiz returns the single complete
  response to the waiting model.
- A finished quiz stays in the conversation as a durable scored result.
- The quiz does not duplicate task-cancellation controls inside the exercise.
  Leaving it unanswered records no invented answers.

## Contract

A quiz has a bounded title and a bounded list of questions. Every question and
answer has an id unique within its parent, visible text, an explicit selection
mode, at least one correct answer, and a non-empty explanation. A single-answer
question has exactly one correct answer. A multiple-answer question may have
several.

The response names every question exactly once and contains only answer ids that
the question offered. A response is returned to the requesting model as a tool
result and retained with the conversation for later turns.

## Invariants

- A quiz cannot bypass permission to perform an external effect; it can only
  collect an answer inside the conversation. Named regression: `advertises
  quizzes without a workspace and validates every answer`.
- The exact pending request must receive the response. A stale or cross-task id
  cannot resume a turn. Named regression: `pauses for the exact quiz response
  and returns its score to the model`.
- No unanswered, duplicate, or unknown question or answer is accepted. Named
  regression: `rejects incomplete and invented quiz responses`.
- A submitted quiz survives task persistence with the questions and selections
  that were actually shown and chosen. Named regression: `persists a submitted
  quiz as one ordered conversation result`.
- The renderer reveals one question at a time, never reveals correctness before
  that question is checked, preserves reviewed answers during navigation, and
  supports both selection modes. Named regression: `checks one quiz question at
  a time and keeps reviewed answers when navigating`.
- Retry clears the whole local attempt, while finishing returns the complete
  response exactly once. Named regression: `shows the final score, resets the
  attempt, and submits only when finished`.
- A pending quiz belongs to the conversation's single scroll surface rather
  than the fixed composer dock. Named regression: `keeps a pending quiz in the
  conversation scroll surface`.

## Limits

This increment grades exact answer sets. Free-text grading and model-judged
answers are deliberately excluded because they cannot produce deterministic,
auditable scores.
