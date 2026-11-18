# Quizzes

The model can give the person a scored quiz: up to twelve multiple-choice
questions, checked one at a time, each with an explanation, ending with a
score. The person works through it in the conversation, and when they finish,
the result goes back to the model and stays in the conversation. Quizzes work
with or without a folder chosen.

A quiz exists only when the model calls the quiz tool. Quiz-like text in an
ordinary message is shown as text.

## What the person sees

- The quiz appears in the conversation, after the latest message, and the
  model waits for it. Its header shows the title, "Question 2 of 5" and a
  progress track that colours each checked question by its outcome.
- One question is shown at a time. A single-answer question uses radio
  buttons. A multiple-answer question uses checkboxes and says "Choose all
  that apply".
- Check answer locks the question and says whether the selection was right,
  with the model's explanation:
  - **Correct**, in green, when the selection is exactly the correct answers.
  - **Not quite**, in red, when the selection includes a wrong answer.
  - **Not quite**, in amber, when a multiple-answer selection holds only
    correct answers but misses some. The missed answers are marked "Missed",
    and the feedback says the question needed both, or all, of its answers.

  Each outcome is also written out, in the feedback and in each answer's
  accessible name, so colour is never the only signal.
- Previous and Next move between questions. Going back shows the saved
  selection and its feedback; a checked answer cannot be changed.
- After the last question, See result shows the score, a marker per question,
  and three ways on: Review answers, Try again, which clears every answer and
  starts over, and Finish quiz. Only Finish quiz sends the result to the model.
- If sending fails, the result screen says so and Finish quiz can be tried
  again.
- The finished quiz stays in the conversation as a card with the score, every
  explanation, and each answer marked Correct, Incorrect, or, where correct
  answers were missed, "Needed both answers" or "Needed all 3 answers".
- The quiz has no stop control of its own. Stop task ends it, and no answers
  are recorded.

## Rules

- A quiz has a title and one to twelve questions. Each question has two to
  eight answers, ids unique within their parent, single or multiple
  selection, at least one correct answer, exactly one for single selection,
  and a non-empty explanation.
- The answers are not shown in the order the model wrote them, since models
  tend to put the correct answer first. Each question's answers are shuffled
  in an order taken from the quiz's own words, so the same quiz always looks
  the same. Answers that are all numbers are shown from smallest to largest.
- A correct answer must not give itself away by its length. When the correct
  answers are all much longer than every wrong one, the quiz goes back to the
  model to be rewritten before the person sees it. The model is also asked to
  keep answers alike in length and detail and never to write "all of the
  above".
- A question counts as correct only when the selection is exactly the set of
  correct answers. Grading compares answer sets, never free text or the
  model's judgment, so the same answers always get the same score.
- The response answers every question once, with answers that question
  offered. Anything else is refused, and the quiz stays open.
- The response reaches only the conversation and the request waiting for it.
- The model receives each question's chosen answers, whether each was correct,
  and the score. The questions, the selections and the score are saved with
  the conversation.
- A quiz changes nothing on the computer or at any service, so it needs no
  approval, and it grants none.
