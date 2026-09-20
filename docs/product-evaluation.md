# Product evaluation

Status: protocol for the next milestone, revised 2026-09-10. Three cases exist as
fixtures in `evaluation/` and all three were run in the installed app on
2026-09-10; the record is in `evaluation/runs/`. They supplement implementation
tests and the local gate.

The cases exist as fixtures in `evaluation/`, one folder each,
with fixed inputs, the verbatim request, and criteria written before any run.
They were drafted by the assistant that built the product, which is a real
weakness recorded in that folder's README: a held-out case has to come from
someone else to mean anything. All three passed on 2026-09-10, which shows it
can do the cases it was shown and is not the same claim.

## Acceptance method

Before implementing a workflow, record a request, fixed input fixtures, allowed
effects, expected deliverable, and independently reviewable success criteria.
The following cases are proposed seeds. A human reviewer must approve their
fixtures and expectations before their results count toward milestone acceptance.
Keep additional cases held out from implementation work.

| Case | Inputs and deliverable | Acceptance criteria |
| --- | --- | --- |
| Research, build, check | An empty folder and a question, into a web page built from researched facts | Named subjects and figures match an answer recorded before the run, no invented numbers, the page opens and its chart agrees with its text, unconfirmed figures are named, and it looked at what it built at two window sizes. |
| Fix and prove | A small project with a reproducible defect, into a fix and a note | A withheld regression passes, the behaviour that was already correct still works, existing tests are intact and unmodified, nothing unrelated changed. |
| Data | A small table with known totals and missing values into a report and a chart | Calculations match independently computed answers, missing values handled explicitly, the chart shows the same figures as the prose, the source table is unchanged. |

The first two are deliberately broad: one job, a prompt of no more than three
lines, and most of the product exercised in a single run. The third is narrow
and covers what neither reaches — arithmetic over supplied data whose answer was
computed independently beforehand.

An earlier set proposed separate writing, research, planning and coding cases.
None was run before the browser and web research worked; the broad cases cover
the same ground with something checkable at the end, and the coding case was the
same shape as `fix-and-prove`. All four were deleted rather than carried as a
backlog.

These cases measure breadth without defining a product scope ceiling.

## Required failure scenarios

Exercise denied permission, interruption during work, restart, unavailable
provider, failed save, and externally changed inputs where relevant. Record
partial outputs and uncertain remote outcomes. A result fails acceptance if it
claims completion without its deliverable or exceeds the allowed effects.

## Run record

Record the application revision, package and model configuration, fixture
version, request, allowed effects, resulting artifact, observed actions,
independent check results, user corrections, elapsed time, and provider-reported
cost when available. Keep private user data out of shared fixtures and reports.
Mark unavailable measurements as unavailable rather than zero.

For sustained-work and held-out runs, also record every limit checkpoint and
whether its token and cost fields were measured, estimated, or unavailable.
Before revealing the result, the reviewer lists the facts and authorization
boundaries that must survive compaction. Afterwards, record each as retained,
lost, or contradicted and judge the deliverable against the same task criteria
used for the un-compacted single-agent baseline. Delegated runs additionally
report the parent's aggregate ledger; a child with a separate allowance fails
the run. A case written by the implementation author is not held out.

Separate the agent's assessment from the reviewer's verdict. Report failures and
blocked cases alongside successes; reruns do not erase the initial result.
Changes to expectations after a failure require an explanation and a new case
version, never a silent adjustment to fit the implementation.

## Milestone acceptance

Each case must produce its expected artifact in the installed app and pass its
independent checks. Intended nontechnical users must then attempt the cases
without developer intervention. Record where they need help and resolve the
blocking issues before calling the milestone complete. Unit tests, browser
previews, and installer generation cannot substitute for these runs.
