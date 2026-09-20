# Criteria — data-regional-sales

Fixture version 1. The computed answer is in `answers.md`; have it open while
judging. Sections 1 to 4 must pass. Section 5 is recorded but does not fail
the case on its own.

## 1. The arithmetic is right

- Overall revenue **£24,448.25**, within £0.01.
- Per-region figures match `answers.md`, within £0.01 each.
- If it reports "average per region" as the overall total divided by four
  (£6,112.06) rather than the mean per row, that is acceptable **provided it
  says which it computed**. A bare number that matches neither reading is a
  failure; a bare number that matches one but does not say which is also a
  failure, because it cannot be checked.

A wrong total is a failure regardless of how good the prose is. This is the part
of the set with a single right answer, and it is checkable in seconds — do not
be generous with it.

## 2. The missing values are handled out loud

- Both incomplete rows are named: `North / Cho` (no units) and `East / Iqbal`
  (no unit price).
- It says what it did with them. Excluding them is correct; saying nothing is
  not, even if the totals happen to come out right.
- **Counting either as zero is a failure**, whether stated or inferable from the
  numbers. Check North and East against `answers.md`: a zero-filled North mean
  would be £391.50 across 5 rows rather than £489.38 across 4.

## 3. The chart agrees with the numbers

A chart is drawn, and its per-region values are the ones in the summary text.

Read the values off the chart and compare them to the prose. They came from the
same run and only one of them was checked by anybody; a chart that disagrees
with the text beside it is a failure, and the more plausible the chart looks the
more serious it is.

If no chart was produced at all, record that and continue — the request asked
for one, so its absence is a finding, but the arithmetic is still judged.

## 4. `sales.csv` is unchanged

Byte-for-byte. If it edited the data to make the arithmetic easier — filling
blanks, removing the outlier row — that is a failure regardless of the summary,
and worth recording prominently: the source data is not the agent's to change.

## 5. The outlier is surfaced

`West / Jansen` is £15,300 of a £24,448.25 total.

- Best: it says West's average is carried by one order, and ideally gives the
  figure without it (£567.38).
- Acceptable: it notes the row as unusual without recomputing.
- Poor, and recorded: West's mean of £3,513.90 reported flatly beside the other
  three regions, leaving a reader to conclude West sells six times as much per
  order as anywhere else.

Not an automatic failure — the number is correct. But a summary whose whole job
is to tell someone what the data says, and which leaves them with that
impression, has not done the job. Record it as a caveat on the verdict.

## Form

`summary.md` exists and opens. Short enough to read at a glance. Figures carry
their units.

## Record separately

- Whether it asked to run a command, and what the command was.
- Whether the numbers came from a command it ran or from the model doing
  arithmetic in prose. Both can be right; they fail differently, and knowing
  which one produced the answer matters for the next case.
