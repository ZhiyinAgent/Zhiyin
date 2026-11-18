# 0009. A mistake the model can fix is answered to the model alone

Status: accepted

## Decision

- **Only the tool says a refusal is correctable**, because only the tool knows
  whether it is about the request's form or about authority: text an edit
  cannot find, a missing required argument, input that is not valid JSON, an
  unknown skill, a shell command that plainly deletes. A refusal for leaving
  the workspace is never correctable.
- **Form is checked before anyone is asked.** An edit is resolved when it is
  inspected; a call's input is checked against the schema its tool offers the
  model, by one schema checker every refusing feature words its refusals
  with, and every mismatch is named. A connector's schema the validator cannot
  read is not held against the call.
- **A slip with exactly one reading is fixed without asking anyone.** Input
  that is almost JSON, such as a call in a code fence or with a trailing
  comma, is read the one way it can be, when nothing about the fix can change
  a value, and the model is told its input was corrected. Anything else,
  including input that stops before it ends, goes back to the model.
- **A correctable refusal reaches the model and nothing else**: no action
  record, no permission request, nothing in the conversation. This happens at
  most three times in a row per tool; the fourth refusal in a row is shown to
  the person, because the model is not converging. When the tool succeeds, its
  count starts again, and its failed calls and their results are taken out of
  what the model is sent next. A view the window does not accept is answered
  the same way.
- **The model that made the call fixes it.** No other model is asked to change
  a refused call: the call that runs is one the model wrote, and it goes
  through inspection and permission as written.
- **Matching ignores what is not a disagreement about content**: line endings,
  a byte-order mark, trailing whitespace, the indentation of a whole block.
  Words that differ do not match. A failed match names the closest line and
  how similar it is, and never quotes the file back.
- **Out of the person's sight is not out of the record.** Every quiet
  correction and every fixed input is written to the corrections log, with how
  many of that tool's calls in a row have now been refused. A failure to write
  it is shown as a workspace issue.

## Why

A person asked for a result. A mismatched edit string or a missing argument
gives them nothing to decide and nothing to do. Kept in the model's context,
its own dead ends are read again as though they still described the file, and
the next attempt gets worse.

The model that made a refused call already holds what it misquoted: the file
it read, the text it meant to find. Told the reason, it sends the call again.
A second model asked to repair the call first sees only an excerpt, adds a
request to the path of every refused call, and needs rules of its own to keep
it from changing what the call writes, sends or runs.

A failure streak is what says a model is not converging. A count per tool per
turn measures the whole turn instead: in a long turn a model edits a document
many times, each slip it corrects on the next call spends one of the tries,
and a later slip is shown to the person although every earlier one was fixed
straight away. The cost of counting in a row: a turn may hide more refusals
from the person in total, each followed by a success. Every one is still in
the corrections log.

A whole call written out again from unreadable raw text cannot be held to its
syntax by a check afterwards, and a loose comparison passes content cut short,
values moved between fields and changed numbers; the model that wrote it can
send it again.

## Rejected

- Showing every refusal as a failed action: noise, with nothing to act on.
- Leaving failed attempts in the model's context.
- More tries per turn: moves the point where a converging model is shown as
  failing, without telling a converging model from one that is not.
- A separate model that repairs the inputs a refusal names before the main
  model is told. Measured over 13 runs (about 230 model requests) and the
  recorded runs before them, 7 refusals reached such a repair, 2 were
  repaired, and none of the last 3 was about the input's shape. The quiet
  answer to the model handles the same refusals, and the repair cost a request
  of its own and the rules that kept it to the inputs named.
- Repairing input that cannot be read as JSON with a model, with a comparison
  afterwards: it refuses some sound repairs, such as reordered keys, and still
  rests on one model writing out another's whole call.
- Exact whitespace matching: Windows line endings would fail systematically.
- Matching words loosely: quietly changes something nobody proposed changing.

## Assumptions

- A model given a specific reason corrects itself within three attempts.
- A success of the same tool means the model is converging, not that it found
  another way to fail.
- A turn that keeps working reaches the work-budget checkpoint (ADR 0010),
  where the person chooses whether it goes on, so successes between refusals
  cannot keep a turn going out of their sight.
- What the model needs to fix a refused call is in its own context: the
  reason, and the observations it made the call from.
- Line endings and whitespace are never what a person meant to distinguish.
