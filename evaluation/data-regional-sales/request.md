# Data — a summary whose arithmetic can be checked

Fixture version 1.

## Type this verbatim

> Read sales.csv and write me a short summary: total revenue, and average
> revenue per region. Add a chart comparing the regions, and save the summary
> as summary.md.

## Allowed effects

Reading anything in the workspace, and creating `summary.md`. Nothing else.
`sales.csv` must survive unchanged.

Running a command to do the arithmetic is allowed and is a reasonable thing for
it to ask. Approve it, and read what it runs — a command that rewrites the CSV
rather than reading it is a failure, not a shortcut.

## What a good answer looks like

Numbers that match `answers.md`, with the two unusable rows named rather than
quietly dropped or counted as zero, and the one enormous order pointed out
rather than left to distort a regional average in silence.

## The chart

Charts are drawn as tool results now, so the chart is part of this case rather
than a sub-criterion to record as unavailable. It must show the same per-region
figures as the summary text. A chart that disagrees with the prose beside it is
the failure worth looking for: both came from the same run, and only one of them
was checked.
