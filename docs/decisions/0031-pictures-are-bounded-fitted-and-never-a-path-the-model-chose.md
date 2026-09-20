# 0031. Pictures are bounded, fitted, and never a path the model chose

Status: accepted

## Context

Three unscripted browser runs on 8 and 9 September 2026 produced nine failed
actions and a quantity of files nobody asked for. Reading the stored
conversations afterwards showed the same three causes.

The packaged automation server writes files, and nothing had told it where. Its
default is the directory the application was started from, which in development
is this source tree: nine screenshots and a folder of console logs were written
into `apps/desktop`. The same default refused to write into the folder the
person had chosen, so the agent's own picture of the page came back "access
denied" and it worked around the refusal by writing where it was allowed. The
approval a person saw said "Capture page". It did not say that a file would be
written, because Zhiyin did not know one would be.

Every run also spent turns on a favicon. A browser asks for one unprompted; the
preview server had no answer, so a page with nothing wrong with it logged an
error and the agent stopped to investigate a defect that was ours.

Full-page screenshots of long pages were refused outright — 390 by 6231 pixels
against a limit of 6000 on a side. The agent learned only that it had failed.
The limit itself was justified by one provider's documented maximum, chosen when
one provider was configured; routing is now an allowlist and the catalogue
publishes no pixel limits at all, so a single hard number can no longer claim to
be the smallest that binds.

## Decision

A picture a conversation refers to is kept by the session store, beside the
conversation, under an id the store issues. The model has no say in where a
picture goes: inputs naming a file are removed from the schema it is shown and
from its arguments if one arrives regardless. Any file the packaged browser
writes on its own goes to one directory the application names, inside
application data.

The picture store is bounded the way file recovery is (ADR 0019): a ceiling for
one picture, a ceiling for all of them, and a maximum age. Oldest go first, and
the picture just saved is never evicted to make room for itself. A conversation
that refers to a picture the store dropped is told it was deleted to save disk
space — one sentence, distinguishable from a picture that was never there.

The initial default limits are 128 MiB in total, 12 MiB for one picture, and 30
days.

A picture larger than the configured model accepts is scaled to fit rather than
refused, and the model is told both sizes. A picture far longer in one dimension
than the other is sent with a plain warning that its text may be unreadable and
that sections can be captured instead. A picture that would be illegible at any
size it could be sent at is described rather than sent, with what to do about
it. None of these is reported as a failed action: the thing the picture is of is
still there to be looked at.

Measuring a picture stays where the picture is produced; deciding what a model
will accept does not. Tools report pixels and hand over what they have.

The preview server answers a favicon request from a workspace that has no icon
with "nothing here", and serves one the workspace does have.

Assumptions: the picture limits cover ordinary browsing and screenshot work
without turning the store into an archive; a scaled picture is more useful than
a refusal even when it has lost detail, provided the loss is stated.

## How the fit ceiling is chosen, 2026-09-10

The first ceiling was 6000 pixels on a side, taken from the one provider
configured at the time. With the model chosen from a catalogue and routing an
allowlist, a number from one provider's documentation cannot claim to bind.

Refusal thresholds turn out to be useless as a guide. Verified 2026-09-10, they
range from 2048 pixels (OpenAI gpt-5.4) through 6000 (gpt-5.5, and Z.AI's GLM
series) to 8000 (Claude) and 65535 (OpenAI's newest models). Which one applies
depends on a model selected long after this code was written, and the catalogue
reports only whether a model accepts images at all, never a size.

What providers agree on is the resolution their models actually read. Claude
downscales to a 1568-pixel long edge, or 2576 on its high-resolution tier;
OpenAI fits a high-detail image inside 2048 by 2048. Pixels beyond those are
discarded on arrival, having been paid for.

So the ceiling is the resolution above which pixels stop being looked at, not
the one above which a request fails. It is 2000 pixels on the longest side:
under the smallest refusal threshold anyone documents, at or above the
resolution most models read, and the size Anthropic asks for when a request
carries many images — which a turn that keeps looking at a page does.

This gives up some detail on Claude's high-resolution tier. That is the price
of one rule that holds for every model the allowlist can reach, and it is
revisited when a catalogue publishes a per-model resolution rather than when
another provider's documentation changes.

## Consequences

An approval that says "Capture page" now describes everything that happens. The
source tree stops accumulating agent output, and application data has one place
to look for what the browser wrote.

Screenshots stop being an unbounded, silently growing store of private page
contents; they follow the same retention and deletion rules as other evidence,
and a conversation stays honest about what it no longer holds.

The agent gets an answer instead of an error from a picture that is too large,
and enough information to decide whether to look again more closely. Extreme
aspect ratios remain genuinely hard: the warning tells the model what it cannot
see, which is the most that can be offered without deciding for it.

A conservative fit ceiling will sometimes scale a picture a particular model
would have accepted whole. That cost is paid to keep one rule for every model
the allowlist can reach.
