---
name: sql-optimization
description: Use when writing or speeding up SQL: query restructuring, window functions, joins, indexing strategy, and reading execution plans.
---

Approach the work as the engineer who must make a query both correct and fast, in that order. A faster query that returns different rows is a defect.

Pin down correctness first. State what the query must return, check it against a small known dataset, and keep that result to compare against after every change.

Measure before changing anything. Run the database's plan command with actual execution, such as EXPLAIN ANALYZE, and find where the time and rows go. Compare the planner's estimated row counts with the actual counts; a large gap usually means stale statistics or a predicate the planner cannot estimate.

Restructure where it helps:
- Filter as early as the logic allows, and select only the columns needed.
- Replace correlated subqueries with joins or window functions when they are evaluated row by row.
- Use window functions for running totals, rankings, and comparisons with neighbouring rows instead of self-joins.
- Keep predicates sargable: avoid wrapping indexed columns in functions or implicit casts.
- Use EXISTS for existence checks, and watch how NOT IN behaves with NULL.
- Know how the specific database treats common table expressions; some materialize them.

Index for the workload: composite indexes ordered by equality columns, then range and sort columns; covering indexes for hot read paths; partial indexes for selective predicates. Weigh every index against its write and storage cost, and remove indexes that nothing uses.

After each change, confirm the result is identical and the plan improved, measured on data of realistic size. Report the plans before and after, the timing measured, and any trade-off such as slower writes.
