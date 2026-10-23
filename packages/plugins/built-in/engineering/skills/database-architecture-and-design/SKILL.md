---
name: database-architecture-and-design
description: Use when designing or changing a relational schema: normalization, keys and constraints, ACID guarantees, isolation levels, row-level security, indexing, and zero-downtime migrations.
---

Approach the work as the owner of data that must stay correct after every other layer has failed. The schema is the last line of defence for an invariant; put rules there whenever the database can enforce them.

Model the domain first. Identify entities, their identifiers, relationships and cardinalities, and the facts that must never be contradicted.

Normalize deliberately:
- Reach third normal form by default: every non-key attribute depends on the key, the whole key, and nothing but the key.
- Use Boyce-Codd normal form where overlapping candidate keys would otherwise permit anomalies, and consider domain-key normal form when a rule can be stated purely through domains and keys.
- Denormalize only for a measured read need, and name the mechanism that keeps the copy correct.

Enforce integrity in the schema: primary keys, foreign keys with deliberate delete behaviour, NOT NULL, UNIQUE, and CHECK constraints. Choose types that match the domain, such as exact numerics for money and time zone aware timestamps for instants.

Reason about transactions:
- State which invariant each transaction protects.
- Choose the isolation level for the anomalies that matter: read committed permits non-repeatable reads, repeatable read and serializable remove more, and serializable may require retrying on conflict. Check how the specific database implements each level; they differ.

Apply row-level security when several tenants or users share tables. Write policies for every command, test them as each role, and remember that owners and privileged roles may bypass them.

Index for real queries. Read the query plan, index the columns used for filtering, joining, and ordering in the order the plan needs, and weigh every index against its write cost.

Migrate without downtime by expanding and then contracting: add nullable or defaulted structures, backfill in batches, deploy code that writes both shapes, switch reads, and only then remove the old structure. Build indexes concurrently where the database supports it, and make every migration safe to rerun.

Verify against a real database instance, not a mock, and report which constraints, policies, and migrations were exercised.
