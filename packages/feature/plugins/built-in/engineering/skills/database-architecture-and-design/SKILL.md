---
name: database-architecture-and-design
description: >-
  Use when designing or changing a relational schema: normalization, keys and constraints, ACID guarantees, isolation levels, row-level security, indexing, and zero-downtime migrations.
---

Approach the work as the owner of data that must stay correct after every other layer has failed. The schema is the last line of defence for an invariant; put rules there whenever the database can enforce them.

**Model the domain first.** Identify entities, their identifiers, relationships and cardinalities, and the facts that must never be contradicted. Draw the model with render_diagram as a Mermaid erDiagram, so the person can check the entities and cardinalities before any table exists. Read the existing schema and migrations first, and follow their naming and conventions.

**Normalize deliberately:**
- Reach third normal form by default: every non-key attribute depends on the key, the whole key, and nothing but the key.
- Use Boyce-Codd normal form where overlapping candidate keys would otherwise permit anomalies, and consider domain-key normal form when a rule can be stated purely through domains and keys.
- Denormalize only for a measured read need, and name the mechanism that keeps the copy correct.
- Avoid a generic attribute-value table for data with a known shape: it gives up types, constraints and plans.

**Choose keys.** A surrogate key (an identity integer, or a UUID where ids are made outside the database; time-ordered UUIDs index better than random ones) keeps references stable; put a UNIQUE constraint on the natural key as well, or duplicates arrive.

**Enforce integrity in the schema:** primary keys, foreign keys with deliberate delete behaviour, NOT NULL, UNIQUE, and CHECK constraints. Choose types that match the domain, such as exact numerics for money and time zone aware timestamps for instants. Index the referencing columns of a foreign key where the database does not do it for you, as PostgreSQL does not: deletes and joins on the parent otherwise scan the child.

**Reason about transactions:**
- State which invariant each transaction protects.
- Choose the isolation level for the anomalies that matter: read committed permits non-repeatable reads, repeatable read and serializable remove more, and serializable may require retrying on conflict. Check how the specific database implements each level; they differ.
- A check-then-insert under read committed races: enforce it with a constraint, or a lock, not with the check alone.

**Apply row-level security** when several tenants or users share tables. Write policies for every command, test them as each role, and remember that owners and privileged roles may bypass them: in PostgreSQL, superusers and roles with BYPASSRLS always do, and a table's owner does unless the table is set to FORCE ROW LEVEL SECURITY.

**Index for real queries.** Read the query plan, index the columns used for filtering, joining, and ordering in the order the plan needs, and weigh every index against its write cost.

**Migrate without downtime by expanding and then contracting:**
1. Add nullable or defaulted structures.
2. Backfill in batches.
3. Deploy code that writes both shapes.
4. Switch reads.
5. Only then remove the old structure.

Build indexes concurrently where the database supports it. Add a constraint to a large table without blocking writes where the database allows it, as PostgreSQL's NOT VALID then VALIDATE CONSTRAINT. Set a lock timeout on each migration, so one that waits behind a long transaction fails rather than stalling every query behind it. Make every migration safe to rerun, and know how each is undone.

**Verify against a real database instance,** not a mock: run the migrations and the tests with bash, which the person approves, against a local or throwaway database. Report which constraints, policies, and migrations were exercised, and what was not.
