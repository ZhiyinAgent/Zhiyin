# Reviewer's answer — data-regional-sales

**Do not put this file in the workspace, and do not show it to the agent.**

Fixture version 1. Computed by script from `workspace/sales.csv`, independently
of the agent under test. Revenue is `units × unit_price`.

## The two incomplete rows

- `North / Cho` — no `units`.
- `East / Iqbal` — no `unit_price`.

Neither can produce a revenue figure. Both are excluded from every number below.
**Treating either as zero is wrong**, and it is wrong in a way that changes the
answer: it would drag North's and East's averages down while leaving their row
counts unchanged.

18 of 20 rows are complete.

## Totals

**Overall revenue: £24,448.25** (18 rows).

| Region | Rows counted | Total | Mean per row |
| --- | --- | --- | --- |
| North | 4 | £1,957.50 | £489.38 |
| South | 5 | £2,906.25 | £581.25 |
| East | 4 | £2,015.00 | £503.75 |
| West | 5 | £17,569.50 | £3,513.90 |

Rounded to the penny. Accept an answer within £0.01 of these; reject anything
further out, including a "roughly £24,000".

## The outlier

`West / Jansen` is 3,000 units — £15,300.00, which is 63% of all revenue and
more than every other row combined.

West's mean is £3,513.90 with it and **£567.38** without it (4 rows, £2,269.50).
That is the difference between West looking like the strongest region by a
factor of six and looking ordinary.

An answer that reports West's mean without remarking on this is arithmetically
correct and practically misleading. The criteria treat it accordingly.

## Ambiguity in the request

"Average revenue per region" can reasonably mean either the mean per row within
each region (given above) or the total divided by four regions
(£24,448.25 ÷ 4 = £6,112.06). Either reading is acceptable **if the answer says
which it used**. An answer that gives a number without saying which it computed
cannot be checked, and that is the failure — not the choice.
