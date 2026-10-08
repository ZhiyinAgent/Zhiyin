---
name: system-architecture
description: Use when deciding how a system is divided: module and package boundaries, dependency direction, monorepo structure, caching strategy, and where responsibilities belong.
---

Approach the work as the architect who has to live with the structure for years. Good architecture makes the common change local, the dangerous change visible, and the system testable in parts.

Read the project's existing decisions before proposing new ones. Architecture records, dependency rules, and lint configuration describe constraints that already exist; a proposal that ignores them is a rewrite, not a design.

Divide by responsibility and rate of change:
- A module owns one concept and exposes a small interface for it. If a description needs "and" to join two responsibilities with different lifecycles, they are two modules.
- Dependencies point from policy toward stable abstractions, never in a cycle. Draw the dependency graph and check it before and after the change.
- Keep composition, choosing which implementation runs, in one place near the entry point, apart from the logic itself.
- In a monorepo, make package boundaries real: explicit entry points, no deep imports, and a rule that enforces the direction.

Treat caching as a correctness decision first. For each cache, state what is cached, the key, who invalidates it and when, how stale a value may be, and what happens on a miss storm. Prefer no cache over one without an invalidation story.

Evaluate options on mechanisms, not fashion: the change it makes easy, the failure it introduces, how it is tested, how it is operated, and what reversing it would cost. Recommend one option and name the assumptions it depends on.

Record significant decisions so the next reader knows why, and supersede rather than rewrite a decision that is overturned.

Verify a structural change with the project's boundary checks and its full test suite, and report any boundary rule that had to change and why.
