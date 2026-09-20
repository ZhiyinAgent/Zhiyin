# 0032. Conversations rewind in place

Status: accepted

## Context

Editing an earlier request must remove the model-visible work derived from it.
Product direction requires one explicit rewind with no alternate conversation.
File effects cannot be inferred from conversation text, and arbitrary commands
can reach beyond the selected workspace.

## Decision

An ordinary user message may be reviewed as a boundary immediately before that
message. Committing removes that message and every later timeline entry from the
active task, returns its text to the composer, and starts no model request. The
same task identity and retained earlier history remain.

The review is bound to the complete source task and fails when the task changes.
New messages and actions use fresh core-owned identities after rewind even when
they occupy an earlier display position. Legacy histories without exact
timeline positions remain readable but cannot be rewound.

Workspace restoration is a separate choice. Only app-owned typed file changes
with durable recovery captures can be restored. Current files remain the
default. Conflicts and unprotected effects stay untouched and are reported.
Shell, MCP, exported, remote, and undeclared effects are never described as a
workspace snapshot.

Assumptions: people expect editing an earlier request to discard its old answer;
keeping current files is the least surprising default; explicit partial
recovery is useful without implying that the computer returned to an earlier
state.

## Consequences

Rewind owns conversation policy, recovery owns file identity and bytes, the
agent loop composes them, and the renderer owns review presentation. A rewind
can truthfully complete while some effects remain.
