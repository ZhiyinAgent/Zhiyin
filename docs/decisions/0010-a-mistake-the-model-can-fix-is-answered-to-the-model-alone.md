# 0010. A mistake the model can fix is answered to the model alone, and a repair changes only the inputs a refusal names

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
- **A refusal names the inputs it is about.** A tool's correctable refusal
  lists the inputs at fault by where they sit in the call, such as `path` or
  `edits[0].replacements[1].find`. How the input departs from the tool's
  schema names more: an input left out, one of the wrong kind, one the schema
  does not define, but never one under a key holding a dot or a bracket, which
  a path cannot spell exactly. A tool never names an input that carries what
  the call writes, sends or runs; the schema check can. A view or a question,
  which only shows something in the conversation, names all of its inputs.
- **A small request may repair those inputs first.** It is given the values of
  the named inputs, with the rest of the call shortened for reference, the
  reason, the tool's schema, what the model said it was doing, and the last
  few calls with their results, not the transcript. It answers with new values
  for those inputs alone; an answer that touches any other input is discarded,
  and everything else in the call stays as the model wrote it. Handing back is
  a valid answer. A repair is tried at most twice, never with arguments already
  refused, and dropped if it does not answer promptly. A repaired call
  replaces the original in the model's record of the turn.
- **What the schema found missing or malformed is filled from the model's own
  call or words.** Each text, number, true-or-false and key put into such an
  input must be one of the values or keys of the call as the model sent it, or
  text that appears in what the model said around the call. Text may also be
  the pieces of the value that stood there, joined: lines sent as a list
  become one text. A value re-shaped keeps every piece of text the model wrote
  there. Otherwise the repair is discarded. An earlier attempt's values are
  never evidence.
- **A repaired call goes through inspection and permission like any other.** A
  call repaired where only the schema found fault asks every time: setting or
  removing such an input means no grant or allowance for the conversation
  covers it, and the person approves it as repaired. An input the tool itself
  names is the tool's to vouch for, and a call repaired there alone is
  approved as any call would be.
- **A refusal that names nothing goes back to the model** quietly, at most
  three times, and the audit log says why no repair was tried. **Input that
  cannot be read as JSON goes back to the model** the same way; no repair
  writes it out again.
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

Naming what a repair may change, rather than what it may not, makes a
forgotten name fail closed: a refusal that names nothing is not repaired. A
list of protected content fields would leave every refusal that names none,
among them every remote connector's schema mismatch, free to rewrite a message
body or a file's text, and under a conversation grant such a call would run
without anyone seeing it.

The schema check names inputs by their shape, not by what they carry, so it
can name a file's text or a message body. Holding the values to the model's
own call keeps invented words out, but not every change of meaning: a line
dropped from a list, or another input's value moved in, is still the model's
own text. Asking for such a call leaves the person to judge it. A whole call
written out again from unreadable raw text cannot be held to its syntax by a
check afterwards, and a loose comparison passes content cut short, values
moved between fields and changed numbers; the model that wrote it can send it
again.

The trade-off: a repair that lands a correct replacement on the wrong
occurrence produces an approval that looks ordinary, and the person reading it
is the check. The narrow mandate and the two-attempt limit exist for that
reason.

## Rejected

- Showing every refusal as a failed action: noise, with nothing to act on.
- Leaving failed attempts in the model's context.
- A list of protected content fields that each tool fills in: a tool that
  forgets still lets a repair rewrite content, and a remote connection cannot
  say which of its inputs carry it.
- Sending the whole call to the repair and comparing the answer afterwards:
  the repair would see, and could reproduce, content it has no business with.
- Repairing input that cannot be read as JSON, with a stricter comparison
  afterwards: it refuses some sound repairs, such as reordered keys, and still
  rests on one model writing out another's whole call.
- Exact whitespace matching: Windows line endings would fail systematically.
- Matching words loosely: quietly changes something nobody proposed changing.

## Assumptions

- A model given a specific reason corrects itself within three attempts.
- The evidence that fixes a stale reference is usually in the last few
  observations.
- The refusals worth repairing are mostly about where a call points: a path,
  the text to find, a name to look up.
- What the model said around a call is evidence of what it meant to send.
- Repairs the schema alone guides are rare enough that asking for each costs
  little.
- Line endings and whitespace are never what a person meant to distinguish.
