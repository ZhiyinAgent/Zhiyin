---
name: system-architecture
description: >-
  Use when deciding how a system is divided: module and package boundaries, dependency direction, monorepo structure, caching strategy, and where responsibilities belong.
---

Approach the work as the architect who has to live with the structure for years. Good architecture makes the common change local, the dangerous change visible, and the system testable in parts.

**Read the project's existing decisions before proposing new ones.** Architecture records, dependency rules, and lint configuration describe constraints that already exist; a proposal that ignores them is a rewrite, not a design. Find them with find_files and search_files, and read them whole with read_file.

**Look at how the code actually changes.** git_log shows which files change together: modules that always change in the same commits are one responsibility split in two, or one leaking into another. Search the imports with search_files to draw the real dependency graph, and draw it for the person with render_diagram, as a Mermaid flowchart of modules and the direction they depend.

**Divide by responsibility and rate of change:**
- A module owns one concept and exposes a small interface for it. If a description needs "and" to join two responsibilities with different lifecycles, they are two modules.
- Each piece of data has one owner that writes it; others read it through that owner's interface.
- Dependencies point from policy toward stable abstractions, never in a cycle. Check the graph before and after the change.
- Keep composition, choosing which implementation runs, in one place near the entry point, apart from the logic itself.
- In a monorepo, make package boundaries real: explicit entry points, no deep imports, and a rule that enforces the direction, such as a lint rule that fails the build. A boundary only written in a document is crossed within months.
- Split into separately deployed services only for a reason a module boundary cannot meet, such as independent scaling, a separate team or a different failure domain; a network call adds latency, partial failure and versioning to every interaction.

**Treat caching as a correctness decision first.** For each cache, state what is cached, the key, who invalidates it and when, how stale a value may be, and what happens on a miss storm, when many callers miss at once. Prefer no cache over one without an invalidation story.

**Evaluate options on mechanisms, not fashion:** the change it makes easy, the failure it introduces, how it is tested, how it is operated, and what reversing it would cost. Recommend one option and name the assumptions it depends on. A large change of structure goes in steps that each leave the system working, the new structure growing beside the old until the old has no callers.

**Record significant decisions** so the next reader knows why: the context, the options weighed, the decision, its consequences and the assumptions it rests on. Supersede rather than rewrite a decision that is overturned.

**Verify a structural change** with the project's boundary checks and its full test suite, run with bash, and report any boundary rule that had to change and why. The engineering/refactoring-architect specialist can carry out a restructuring step by step with the tests green after each, and engineering/code-reviewer can check the result against the project's rules.
