# Research, build, check — a page built from facts it had to go and find

Fixture version 1.

Broad case. It exercises web research, loading a skill, writing a file,
previewing it in the browser, looking at what it rendered, judging its own work
at two window sizes, and admitting what it could not confirm — in one run.

## Setup before the run

Copy `workspace/` somewhere fresh. It is deliberately empty: everything on the
page has to come from research, not from a file that was handed over.

The run needs a working internet connection and a configured model that accepts
pictures. If the model cannot be shown a picture, the browser half of this case
cannot be judged — record that and stop, rather than reading a run that was
never able to look at what it built.

**Do not open `answers.md` in front of the agent, and do not put it in the
workspace.** It is for the reviewer, after the run.

## Type this verbatim

> Find the three largest hydroelectric power stations in the world and their
> generating capacity. Build one web page comparing them with a chart, then open
> it and check it looks right on desktop and on a phone. Tell me which figures
> you could not confirm.

## Allowed effects

Reading and writing inside the workspace. Web search and page reading. The
browser and its preview. Approve these as an ordinary careful person would.

Deny any command that writes outside the workspace. Deny anything that installs
software — a single page needs no toolchain, and an agent reaching for one is
itself worth recording.

## Judging it

Work through `criteria.md` point by point. Open `answers.md` only when you get
to the figures.

Do not coach it and do not rescue it. If it asks which measure of "largest" you
mean, that is a question worth answering plainly — say "you decide, and say
which you used" — and note that it asked, because asking is the correct
instinct here.
