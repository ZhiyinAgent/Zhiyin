# 0014. A failure the model can fix is answered to the model alone

Status: accepted

## Context

`multi_edit` fails when its proposed text is not in the file. That happens
often and for uninteresting reasons: the model quoted a block with different
indentation, wrote Unix line endings into a Windows file, or worked from a stale
reading. Every one of those reached the person as a failed action in the
transcript, and every one of them stayed in the model's context afterwards.

Both are wrong. A person asked for a result, not for a report that Zhiyin's
first attempt at expressing an edit did not parse; there is no decision for them
to make and nothing for them to do. And a model that keeps its own dead ends in
context re-reads them as though they still described the file, which makes the
next attempt worse rather than better.

There was also a sequencing error. The match was checked during *execution* —
after the permission request. A person could be asked to approve an edit that
was never going to apply.

## Decision

A tool may mark a refusal `correctable`: the model can fix this itself by
proposing a better call. Only the tool can make that judgement, because only the
tool knows whether the refusal is about the request's form or about authority.
Leaving the workspace is never correctable, however it arose.

The loop answers a correctable refusal to the model and to nowhere else — no
action record, no permission request, nothing in the transcript — at most three
times per tool per turn. The fourth is shown, because at that point the model is
not converging and the person needs to know.

Once that same tool succeeds, the earlier attempts are removed from the request:
both the tool results and the calls that produced them, so no result is left
referring to a call the assistant no longer made. The model finishes the turn
carrying what happened, not what it tried.

`multi_edit` now resolves the whole edit while it is being *inspected* — every
file read, every replacement located, the resulting text computed — so a
proposal that cannot be applied fails before a permission request is built from
it. Execution resolves again rather than trusting the earlier pass, which is
also how an edit whose file changed while it waited is caught.

Matching itself became tolerant of the things that are not disagreements about
content: line endings, a byte-order mark, trailing whitespace, and the
indentation of a whole block. It stops there. Text whose words differ does not
match, because the alternative is quietly changing something nobody proposed
changing.

Assumptions: a model given a specific reason will usually correct itself within
three attempts; whitespace and line endings are never what a person meant to
distinguish; three attempts is cheap next to a wrong edit.

## Consequences

Ordinary self-correction becomes invisible, which is what it should always have
been, and the transcript is once again a record of work rather than of protocol
noise. Windows files stop being a systematic source of failure.

Costs. Inspection now reads file contents before any approval, to decide whether
an edit applies. That is a read the person did not separately authorise, so its
results are strictly contained: a failure names a line number and a similarity
percentage and never quotes the file back. The model is told to read the file
again rather than being handed content it was not approved to see.

A quiet failure leaves no trace the person sees. It is no longer untraceable:
the audit feature keeps a durable record of every quiet correction, added after
this decision was taken and described in ADR 0016's consequences. Nothing in the
app reads that record yet, so a model failing the same way across many turns is
still invisible from inside the app — but the evidence now exists to look at.

Three is a guess informed by nothing but judgement. It is a constant in one
place, and changing it is a one-line change.
