# 0014. A mistake the model can fix is answered to the model alone

Status: accepted

## Decision

- **Only the tool says a refusal is correctable**, because only the tool knows
  whether it is about the request's form or about authority: text an edit
  cannot find, a missing required argument, input that is not valid JSON, an
  unknown skill, a shell deletion. A refusal for leaving the workspace is never
  correctable.
- **Form is checked before anyone is asked.** An edit is resolved when it is
  inspected; a connector call is checked against the tool's published input
  schema, and every mismatch is named. A schema the validator cannot read is
  not held against the call.
- **A correctable refusal reaches the model and nothing else**: no action
  record, no permission request, nothing in the conversation. This happens at
  most three times per tool per turn; the fourth is shown to the person,
  because the model is not converging. When the tool then succeeds, the failed
  calls and their results are taken out of what the model is sent next.
- **A small request may re-aim the call first.** It is given the refused
  arguments, the reason, the tool's schema, what the model said it was doing,
  and the last few calls with their results, not the transcript. It may change
  where a call points, never what it would write: each tool names its content
  fields, and a repair that changes one is discarded. Handing back is a valid
  answer. A repair is tried at most twice, never with arguments already
  refused, and dropped if it does not answer promptly. A repaired call goes
  through inspection and permission like any other, and replaces the original
  in the model's record of the turn.
- **Matching ignores what is not a disagreement about content**: line endings,
  a byte-order mark, trailing whitespace, the indentation of a whole block.
  Words that differ do not match. A failed match names the closest line and
  how similar it is, and never quotes the file back.
- **Out of the person's sight is not out of the record.** Every quiet
  correction, every applied repair with what it changed, and every discarded
  repair with its reason is written to the audit log. A failure to write it is
  shown as a workspace issue.

## Why

A person asked for a result. A mismatched edit string or a missing argument
gives them nothing to decide and nothing to do. Kept in the model's context,
its own dead ends are read again as though they still described the file, and
the next attempt gets worse. The fix for a stale reference is almost always in
the last observation, which a narrow request answers more cheaply than the
whole conversation.

The trade-off: a repair that lands a correct replacement on the wrong
occurrence produces an approval that looks ordinary, and the person reading it
is the check. The narrow mandate, the protected content fields and the
two-attempt limit exist for that reason.

## Rejected

- Showing every refusal as a failed action: noise, with nothing to act on.
- Leaving failed attempts in the model's context.
- Letting a repair change content: a different action nobody proposed.
- Exact whitespace matching: Windows line endings would fail systematically.
- Matching words loosely: quietly changes something nobody proposed changing.

## Assumptions

- A model given a specific reason corrects itself within three attempts.
- The evidence that fixes a stale reference is usually in the last few
  observations.
- Line endings and whitespace are never what a person meant to distinguish.
