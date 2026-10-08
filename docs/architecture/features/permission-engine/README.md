# Permission engine

## Purpose

Every action the agent wants to take passes through this engine before it
runs. The engine answers one question: may this run without the person
deciding? It returns a decision with a reason. No other part of the app makes
that call (ADR 0006).

## Boundaries

- **Owns:** the decision logic, the policy it applies, and the reason attached
  to every decision.
- **Does not own:** running a tool (tools and connectors), the approval wording
  a person reads (agent loop and renderer), recording decisions (the action
  record on the conversation), permissions a person grants for a conversation
  (agent loop), or whether an MCP server may connect at all (MCP).
- **Talks to other features only through:** `decide(action)`. Callers get a
  decision and a reason, never the rule that produced it.

## Public interface

- `decide(action) → Promise<Decision>`. The action carries:
  - its owner, assigned by the app: `built-in`, `mcp`, `skill` or `plugin`;
  - the validated tool name and arguments;
  - the action, target and command shown to the person;
  - what the implementation declared about it: `access` (`read` or `change`)
    and `scope` (`workspace` or `outside`). Either may be missing.
- `Decision = { outcome: 'allow' | 'ask' | 'deny', reason: string }`.
- `GuardedPermissionEngine` is the policy the app runs. `AskPermissionEngine`
  asks for every action.

## The policy

An action runs without asking in exactly two cases:

- Its owner is `built-in`, and its implementation declared both that it only
  reads and that it stays inside the selected workspace. Reading, listing and
  searching files in the workspace fall here.
- Its owner is `skill` or `plugin`, and it is declared as a read: the app
  reading what an enabled plugin contains, such as a skill's instructions or a
  plugin's inventory.

Everything else asks:

- writing, editing or deleting files;
- shell commands, whatever their text;
- reads that reach outside the workspace;
- built-in actions that do not declare both facts;
- every tool reached through MCP, including the app's built-in connections:
  the browser, Git, the document compiler and the Python environment.

When the engine asks, the agent loop may answer with a permission the person
granted earlier in the conversation; otherwise it waits for the person. The
policy never returns `deny`. A `deny` from a policy would refuse the action
even where a conversation permission covers it.

## Invariants

- Authority comes from a declaration made by code the app owns, never from a
  tool's name. Whoever writes a tool chooses its name, so a connected tool
  that calls itself `load_skill` or `read_file` gains nothing. An MCP server's
  own read-only annotation counts for nothing here for the same reason.
- Silence is not a claim. A built-in that does not say what it does is treated
  as changing state and reaching anywhere, so a new tool cannot become
  automatic by leaving something out.
- Containment is decided once, by the implementation that enforces it, and
  passed in as `scope`. The engine never works it out again from the displayed
  target: a second check would be a second boundary to keep in step.
- A shell command always asks. Nothing in a command string bounds what it
  reaches, so no text earns it automatic approval (ADR 0007). Looking around
  the workspace goes through the typed read tools instead.
- Every decision carries a plain reason for audit and failure handling, never
  a rule object or internal code. The wording a person sees on an approval is
  written elsewhere (ADR 0010).

## Testing notes

The engine's correctness rests on its tests: a rule that wrongly approves a
destructive action type-checks perfectly, and its package boundary is held by
lint, not the compiler (ADR 0002). The tests are an adversarial corpus of
concrete action shapes, each mapped to the expected decision and reason. A
bypass found during development is added to it permanently. Tests check the
returned `Decision`, never which rule fired.

That callers cannot get around the engine is a separate claim, tested in the
agent loop against a real filesystem effect.
