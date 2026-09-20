# Evaluation cases

Three realistic jobs, each with a fixed input, a fixed request, and criteria
written down before the run. They answer one question: is Zhiyin any good at
this yet? The protocol they serve is `docs/product-evaluation.md`.

These are not unit tests and not a benchmark. Nothing here produces a score.
Each case produces a verdict — the deliverable is acceptable, or it is not, and
the reason is recorded.

## Three cases, two of them broad

Two cases are deliberately wide: one job, one prompt of no more than three
lines, touching most of the product in a single run. `research-build-check`
covers research, skills, writing a file, the browser, looking at a picture, and
admitting uncertainty. `fix-and-prove` covers reading a project, running
commands, editing, writing, and reporting honestly. Between them they exercise
nearly every part of the system, which is the point: a defect anywhere shows up
somewhere.

The third, `data-regional-sales`, is narrow and covers the one thing neither
broad case does: arithmetic over a table that was handed over, with missing
values, an outlier, and a request that can be read two ways.

An earlier coding case tested a defect fixed against a withheld regression.
`fix-and-prove` is the same shape and exercises the same machinery, so keeping
both meant running one case twice.

An earlier set included three judgement-only cases for writing, research and
planning. None was ever run, and the two broad cases cover the same ground with
something checkable at the end of it, so they were deleted rather than kept as
a backlog nobody reads. They are in git history if the reasoning needs revisiting.

## Who wrote these, and why that matters

The assistant that built the product also drafted these cases. That is a real
weakness and it is recorded here rather than hidden: someone who knows how the
implementation works will, without meaning to, write cases it handles well.

Three things reduce it, none of them eliminate it.

The criteria are checkable by someone who has not read the code. Where an
answer is a number or a passing test, it was computed or written separately and
is stored apart from the workspace the agent sees.

A reviewer must approve each case before its result counts. Approving means
reading the input and the criteria and agreeing that a good answer would satisfy
them — not agreeing that they look thorough.

**Held-out cases must not come from the assistant.** Everything in this folder
has been seen by the model that will be evaluated on it. To learn anything the
first run does not already tell you, alter these inputs, or write a sixth case,
without showing it beforehand. Until that happens, treat these results as
"it can do the cases it was shown", which is worth knowing and is not the same
claim.

## Layout

Each case is one folder:

- `request.md` — the exact words typed into Zhiyin, and what it is allowed to
  touch. Type the request verbatim; paraphrasing changes the case.
- `workspace/` — the folder selected in Zhiyin. This is everything the agent can
  see.
- `criteria.md` — what makes the result acceptable, and how to check each point.
- `answers.md`, `regression/` — where present, the independently established
  answer. **Reviewer only.** These must never be inside `workspace/`, and must
  not be shown to the agent during a run.

## Running one

1. Copy the case's `workspace/` somewhere fresh. Runs change files; the fixture
   must not drift between runs.
2. Open Zhiyin, choose that copy as the folder, and type the request verbatim.
3. Approve or deny actions as an ordinary careful person would. Do not coach it,
   and do not rescue it — a case where the reviewer supplied the answer has
   failed, whatever the output looks like.
4. Work through `criteria.md` point by point against what it produced.
5. Record the run using `docs/product-evaluation.md`'s run record: revision,
   model, fixture version, request, observed actions, the artifact, each
   criterion's result, corrections needed, elapsed time, and provider-reported
   cost where available. For sustained work, include limit checkpoints and the
   predeclared facts and authorization boundaries retained or lost across each
   compaction. Mark anything unmeasured as unavailable, never zero.

Record failures alongside successes. A rerun does not erase the first result.
If a case turns out to be wrong or unfair, fix it — with an explanation and a
new version, never a silent edit that makes a past failure disappear.

## What each case is for

| Case | The thing it actually tests |
| --- | --- |
| `research-build-check` | Facts it had to go and find, a page built from them, and whether it looked at what it built or only said it did. |
| `fix-and-prove` | A real defect fixed and proven, without breaking the behaviour that was already correct. |
| `data-regional-sales` | Arithmetic that matches an independently computed answer, missing values handled out loud, and a chart that agrees with the prose beside it. |

Every one is built around something that should *not* be answered smoothly.
A case the agent can satisfy by being agreeable tests nothing. Each carries a
trap: behaviour that is already correct and that a careless fix breaks, a second
measure that silently changes the answer, or a number that is only checked in
one of the two places it appears.
