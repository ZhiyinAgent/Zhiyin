# Permission engine

## Purpose

Every action the agent wants to take against the filesystem, shell, or network
passes through here first. It returns one of three decisions — allow, ask, deny
— with a policy reason. This is the single place "is this safe" is decided;
nothing else in the app makes that call independently.

## Boundaries

- **Owns:** the decision logic and the policy data it reads from; the policy
  reason attached to every decision; the audit trail of
  decisions made (what was asked, what was decided, why) — even if that
  trail is physically stored by the session feature, this feature is
  the one producing the entries.
- **Does not own:** actually running a tool (tools feature), writing or rendering
  task-specific approval copy (agent loop and renderer), or deciding whether an MCP server
  is trusted enough to connect in the first place (mcp feature — this
  engine only evaluates calls to servers that are already connected).
- **Talks to other features only through:** one entry point —
  `evaluate(call) → Decision`. Callers get a decision and a reason;
  they never see or depend on which internal rule produced it.

## Public interface

- `decide(action) → Decision`, where the action contains its implementation owner,
  validated tool name, arguments, user-facing action and target, and technical
  command detail.
- `Decision = { outcome: 'allow' | 'ask' | 'deny', reason: string }`.
- The current production policy automatically permits an action only when its
  owner is built-in and the implementation declared both that it only reads and
  that it stays inside the selected workspace. File changes, shell execution,
  reads that reach outside the workspace, skill loading, and all MCP tools
  require an explicit decision from this engine. A remote tool cannot inherit
  built-in authority by choosing the same name or annotating itself read-only.
  The agent loop may satisfy an `ask` with a conversation permission the person
  previously granted; the engine's `deny` always takes precedence. Hard-block
  policy is not implemented.

## Invariants

- Authority follows a declaration made by an implementation the app owns, never
  a tool's name. A built-in that declares nothing is treated as changing state
  and reaching anywhere: silence is not a claim. Named test: the adversarial
  corpus cases for an undeclared access and an undeclared scope.
- Containment is computed once, by the implementation that enforces it, and
  carried here. This engine never re-derives it from the displayed target — a
  second predicate would be a second boundary to keep in sync with the one that
  actually holds. Named test: "a read outside the selected workspace remains
  approval-required".
- Shell actions do not receive content-based authority. Until command
  classification exists, every shell action requires an explicit decision,
  regardless of whether its text looks benign. Named tests: "a shell action
  with chained commands remains approval-required" and "an interpreter shell
  action remains approval-required".
- Every decision carries a reason suitable for policy audit and failure
  handling, not a rule object or internal code. For an asked decision, ADR 0008
  keeps task-specific display copy outside this safety boundary.

## Testing notes

- Maintain a fixture corpus of concrete authority and declaration shapes mapped
  to expected decisions. New bypasses found during development get added here
  permanently, not fixed and forgotten.
- Do not test by asserting a particular internal rule object fired;
  test the returned `Decision`.

## Open questions

- Where the audit trail is physically durable — inside this feature or
  handed off to the session feature to store — is undecided; leaning
  toward session owning storage and this feature owning content, to
  avoid this feature also becoming a persistence layer.
- Whether any shell command can ever be automatic. Nothing in a command string
  bounds what it reaches, so the current answer is no, and the typed read tools
  exist so that looking around does not have to go through the shell.
- Hard blocks, project-wide remembered rules, command parsing, redirection scope checks, and
  ambiguity-driven denial are deferred with command classification. The current
  production policy returns only `allow` or `ask`.

## Resolved by ADR 0001 (Electron / all-TypeScript core)

This engine is its own package inside the core, evaluating every call
once before it reaches a tool. The renderer is sandboxed with no Node
access and reaches the core only through the preload bridge, so it has
no independent path to the filesystem or shell — there is no second
boundary to keep in sync.

Note what the type system does *not* buy here. This engine fails
through logic: a rule that wrongly approves a destructive command
type-checks perfectly. Its correctness comes from the adversarial
corpus and property tests, nothing else. Nor does the package boundary
protect it — that is a lint rule (ADR 0001), which is why the test that
a caller *cannot bypass* the engine matters more than usual.
