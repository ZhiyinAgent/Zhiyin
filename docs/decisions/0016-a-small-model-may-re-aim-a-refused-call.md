# 0016. A small model may re-aim a refused call, never rewrite it

Status: accepted

## Context

ADR 0014 made a correctable refusal invisible to the person and handed it back
to the main model to fix. That works, but it is the expensive way to fix a small
thing: a full round trip through the whole conversation to change one `find`
string that was quoted from a slightly stale reading.

The information needed to fix it is almost never in the conversation anyway. It
is in the last action's result — the file that was read a moment ago, which says
exactly what the text is now.

## Decision

Before a correctable refusal reaches the main model, a small model is asked to
re-aim the call. It is given a deliberately narrow view: the refused arguments,
the reason, the tool's description, the person's request, and the last few
actions with what they observed. Not the transcript.

It answers with a repair or a handover. Handing back is presented as a correct
and expected answer, for anything it would have to guess at; a handover falls
through to the behaviour ADR 0014 already defined.

Four checks stand between its answer and the workspace.

**It may re-aim, never rewrite.** The tool names the argument fields that carry
content — `replace` for an edit, `command` for a shell call — and a repair whose
values under those fields differ, in value or in order, is discarded without
being looked at further. Changing *where* an action points is a correction.
Changing *what it would write* is a different action that nobody proposed.

**It proposes; it never authorises.** A repaired call re-enters at inspection
and goes through permission exactly as though the main model had written it.
Nothing here can put an action past a person, and the approval binding still
holds the final call to the exact inspection that was approved.

**It must make progress.** Arguments already refused this turn are not tried
again, and it gets at most two attempts.

**It must answer promptly.** A repair that has not returned within its timeout is
abandoned rather than waited on.

When a repair succeeds, the model's own record of the call is rewritten to the
arguments that actually ran, so it is not left holding a draft that never
happened and reasoning from it afterwards.

Assumptions: the evidence that fixes a stale reference is usually in the last
few observations; a small model given a narrow, specific question answers it
better than a large model given the same question buried in a long context; a
handover is cheap and a wrong edit is not.

## Consequences

The common self-correction — text moved, occurs twice, path off by a folder —
resolves without a main-model round trip, and the person sees only the action
that ran.

This does widen what the auxiliary model may touch. ADR 0008 confined it to
presentation and criteria specifically so that generated output could not affect
execution, and a repair does affect execution: it decides which text an approved
edit lands on. The confinement that replaces it is narrower but real — content
fields are mechanically protected, and every repaired call is inspected and
approved like any other. ADR 0008's reasoning about *authority* still holds; its
statement that the auxiliary model never influences execution does not, and this
decision supersedes that part of it.

What is not protected. The content check is mechanical; "re-aimed at the right
place" is not, and cannot be. A repair that lands a correct replacement on the
wrong occurrence produces a permission request that looks ordinary, and the
person is the only thing standing there. That is the same exposure the main
model already has, reached by a cheaper model with less context — which is
precisely why the mandate is narrow, the attempts are few, and handing back is
described to it as the better answer.

Repairs are recorded. Every applied repair, with the arguments before and after,
and every rejection with its cause, is appended to a durable audit record by the
audit feature — `content-changed`, a repair that tried to alter what an approved
action would write, most of all. Nothing in the app reads that record yet, so
the evidence exists but nobody is looking at it; giving it a surface belongs to
`tasks/preserve-execution-evidence.md`.

The repair prompt carries file content from earlier observations. That content
was read under approval and is already bounded and credential-redacted by the
evidence rules, so this is re-use rather than a new disclosure — but it does
mean workspace content reaches the auxiliary model, which before this decision
it did not.
