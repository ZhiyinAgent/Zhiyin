# 0043. Specialists are child runs of the owning turn

Status: superseded by 0044

## Context

Specialist definitions currently describe useful roles but cannot execute. A
delegated run introduces another model loop, yet it must not introduce another
source of authority, another work allowance, or an invisible conversation. The
existing agent loop already owns tool sequencing, permission decisions,
cancellation, durable task transitions, and the renewable work ledger. Its turn
ownership structure already forms a tree.

**Assumptions this decision depends on:**

- A specialist is useful when it receives a narrow task and returns a bounded
  handoff, not when it becomes an independent conversation.
- The parent's selected model and provider are suitable for first-party
  specialists until plugins can declare a separately reviewed model policy.
- Sequential children are sufficient for the first release. Parallel children
  would make permission prompts, action order, and shared budget checkpoints
  ambiguous without a scheduler.
- Two levels of delegation and three children from one run cover the released
  roles without allowing an unbounded execution tree.

## Decision

A specialist executes as a child run of the turn that requested it. The agent
loop owns a `delegate_specialist` tool and offers it only when at least one
enabled specialist is executable. Capabilities joins personal definitions and
enabled plugin declarations, retains their provenance, and refuses duplicate
identities; it does not run them.

The child receives the selected specialist's instructions, its exact assigned
task, bounded workspace context, and the same callable capabilities as its
parent. Every child tool call passes through the ordinary inspection,
permission, recovery, and execution path. Delegation itself grants no
permission. Disabling a definition or its plugin prevents a new child from
starting; a child already started keeps the immutable definition recorded with
its run.

Parent and child share one renewable work ledger, including elapsed time,
tokens, provider cost, and completed tool rounds. A child does not receive a
fresh allowance. Reaching a checkpoint pauses the owning task through the same
core-owned prompt. Renewal renews the shared tranche for the whole tree.

Execution is sequential. A run may start at most three children and delegation
depth is at most two. Attempts beyond either bound return a structured refusal
without starting model work. Cancellation of a parent aborts every descendant;
ending a child aborts its descendants. A user denial in any child stops the
owning root turn because authority belongs to that root.

Each child is stored on its owning task with its parent run, depth, specialist
identity, source plugin or personal provenance, assigned task, status, start and
finish times, and structured handoff. A process restart changes every stored
`running` child to `interrupted`; it never fabricates a continuation. The
handoff contains a summary, findings, recommendations, and limitations. The
parent model receives that structure together with the recorded provenance.

## Consequences

- Specialist work is inspectable as part of one task and survives restart.
- A plugin-wide switch withdraws its specialists without erasing definitions or
  historical runs.
- Child actions appear in the same ordered action history and use the same
  permission policy as parent actions.
- Parallel specialist execution, resumable children after restart, and
  specialist-specific model selection remain unavailable until separately
  designed.
- Release still requires held-out comparisons against the same tasks without
  delegation; implementation tests do not establish that delegation improves
  quality.
