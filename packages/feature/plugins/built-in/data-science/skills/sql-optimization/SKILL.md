---
name: sql-optimization
description: >-
  Use when writing or speeding up SQL: query restructuring, window functions, joins, indexing strategy, and reading execution plans.
---

Approach the work as the engineer who must make a query both correct and fast, in that order. A faster query that returns different rows is a defect.

**Know where the database is.** A SQLite file in the workspace is opened from run_python with Python's own sqlite3 module. A database server is reached with its own client, such as psql, through bash, which the person approves command by command; run_python reaches only the HTTPS hosts a script names, through Zhiyin's proxy, so a database driver with a connection of its own, as PostgreSQL's or MySQL's, reaches nothing there. Name the database and its version first: plans, optimizer rules and SQL features differ between PostgreSQL, MySQL, SQL Server, SQLite and the rest.

**Pin down correctness first.** State what the query must return, check it against a small known dataset, and keep that result to compare against after every change. Compare row counts and a checksum of the result, such as a sum or a hash of the sorted rows, not only a glance at the first rows.

**Measure before changing anything.** Run the database's plan command with actual execution, such as EXPLAIN ANALYZE, with BUFFERS in PostgreSQL, and find where the time and rows go.
- EXPLAIN ANALYZE runs the statement. For an INSERT, UPDATE or DELETE, run it inside a transaction and roll it back, and never on production data without the person's say.
- Compare the planner's estimated row counts with the actual counts; a large gap usually means stale statistics or a predicate the planner cannot estimate. Refresh statistics (ANALYZE) before judging a plan.
- Time several runs and take the middle one: the first run reads from disk, later ones from cache.

**Restructure where it helps:**
- Filter as early as the logic allows, and select only the columns needed, never `SELECT *` in code that ships.
- Replace correlated subqueries with joins or window functions when they are evaluated row by row.
- Use window functions for running totals, rankings, and comparisons with neighbouring rows instead of self-joins.
- Keep predicates sargable: avoid wrapping indexed columns in functions or implicit casts. `WHERE created_at >= '2026-01-01' AND created_at < '2026-02-01'` can use an index on created_at; PostgreSQL's `WHERE date_trunc('month', created_at) = '2026-01-01'` cannot.
- Use EXISTS for existence checks, and watch how NOT IN behaves with NULL: one NULL in the list makes it match nothing.
- Page with a key, `WHERE id > :last_id ORDER BY id LIMIT 50`, rather than a large OFFSET, which reads and discards every row before it.
- Find queries run once per row by the application (the N+1 pattern) and replace them with one query over the set.
- Know how the specific database treats common table expressions; some materialize them.

**Index for the workload:** composite indexes ordered by equality columns, then range and sort columns; covering indexes for hot read paths; partial indexes for selective predicates. Weigh every index against its write and storage cost, and remove indexes that nothing uses. Build an index on a live table the way the database allows without locking writes, such as CREATE INDEX CONCURRENTLY in PostgreSQL.

**Confirm after each change** that the result is identical and the plan improved, measured on data of realistic size: a plan on a hundred rows says nothing about ten million. Report the plans before and after, the timing measured, and any trade-off such as slower writes.
