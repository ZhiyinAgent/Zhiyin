# Clarifying questions

When a missing choice would change the work, the model can pause and ask the
person up to three short questions instead of guessing. The person answers in
a small form, the answers go back to the model as the result of the call that
asked, and the work continues. Questions work with or without a folder chosen.

## What the person sees

- The questions appear above the message box, where approvals appear,
  headed "A few details" and the request's title. They read as questions, not
  as a request for permission.
- A question offers two to five choices, a written answer, or both. With both,
  a "Something else" field sits below the choices. Each question takes one
  answer: choosing an option clears the written text, and writing clears the
  choice.
- Several questions are shown one at a time, with "Question 2 of 3" and a
  progress track in the header, and Previous and Next to move between them.
  Moving back shows the answer already given.
- After the last question, a review lists every question with its answer and
  a Change button, and Send answers sends them together. A single question has
  no review: Send answer sends it.
- Next and Send stay unavailable until the current question is answered.
- Stop task is available at every step and asks for confirmation. It stops
  the work, and no answer is recorded.
- If sending fails, the form says so in place and keeps every answer.
- Once answered, the questions and answers stay in the conversation as a
  compact record.

## Rules

- A request has a title and one to three questions. Question ids are unique,
  and option ids are unique within their question. Every question offers
  choices, allows a written answer, or both.
- Every question must be answered. An answer is exactly one offered option or,
  where the question allows it, non-empty text.
- An answer that breaks these rules is refused with the reason, and the
  questions stay open for a corrected answer.
- An answer reaches only the conversation and the request waiting for it.
  Once the work is stopped, a late answer cannot restart it.
- Asking changes nothing on the computer or at any service, so it needs no
  approval. It grants none either: an action that follows from an answer is
  reviewed and approved on its own.
