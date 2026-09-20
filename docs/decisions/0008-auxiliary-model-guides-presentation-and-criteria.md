# 0008. Auxiliary model output guides presentation and criteria, not policy

Status: accepted; two claims below amended by ADR 0016, one assumption amended
by ADR 0022, the single auxiliary dependency and its cost assumption amended by
ADR 0046

ADR 0046 splits the one auxiliary dependency below into two — presentation and
judgement — and withdraws the cost assumption recorded here. The model named
below is no longer fixed: auxiliary work follows the model a person selects.

ADR 0022 replaced JSON mode with a tool call for every auxiliary request, so
the assumption below that the configured model keeps accepting OpenRouter JSON
mode is no longer relied on. The reason is provider support: `tools` is served
by every upstream of the configured model, JSON mode by fewer, and schema
enforcement by fewer still.

ADR 0016 lets the auxiliary model re-aim a refused tool call before the main
model sees it. Two sentences written here are therefore no longer true as
written: that auxiliary output cannot change the inspected target or command,
and that there is no hidden retry policy. The text below is left as it was
decided. What replaced it, and the narrower confinement that took over, is in
ADR 0016.

## Context

Tool inspection supplies an exact action, target, and command, but its action
label is often written for reuse rather than for the current task. Showing that
label unchanged produced repeated generic copy. Internal loop mechanics also
appeared as progress items even though they described no user-observable work.

A task needs a small ordered plan that can change while work runs, and each
item needs a stated condition for completion. That state must remain separate
from the action audit and from permission enforcement.

**Assumptions this decision depends on:**

- The configured GLM 5.3 Flash model continues to accept OpenRouter JSON mode.
- The added model requests have acceptable latency and provider cost for the
  current development milestone.
- A bounded action result or final answer is sufficient evidence for the
  criteria used in ordinary tasks.
- Generated titles, descriptions, plans, and evaluations are untrusted and can
  be absent or malformed.

## Decision

The agent loop uses the configured GLM 5.3 Flash client for three bounded
auxiliary requests: an ordered plan with observable criteria, a title and
description for an inspected action, and an evaluation of one criterion against
bounded evidence. Requests use JSON mode and local validation because the
model's verified capability is JSON mode, not strict schema enforcement. The
model client requires an OpenRouter provider that supports the requested
parameters so a routed provider cannot silently ignore JSON mode.

Auxiliary output cannot change the inspected target or command, the permission
decision, or whether a tool executes. A malformed plan is omitted. Malformed
action copy falls back to concise target-specific copy rather than repeating
the user's question. A criterion
that cannot be evaluated remains unresolved; it does not trigger retries or
additional actions.

The task stores the plan as an ordered ledger with pending, active, checking,
verified, and unresolved states. The renderer presents that ledger separately
from the temporary action trace and durable action history. The main model is
asked to state the purpose of an action briefly before requesting it.

This does not implement the referenced goal-mode design. There is no autonomous
iteration loop, evidence-handle protocol, context compaction, or hidden retry
policy.

## Consequences

- Action approvals and history can describe why an action serves the current
  task without exposing provider-facing tool names as ordinary copy.
- Criteria can be checked as work progresses and remain visible across a
  restart.
- Auxiliary requests add latency and cost. Usage is recorded through the same
  provider telemetry path as the main response.
- Requiring request-parameter support can narrow OpenRouter's eligible provider
  set. That constraint is preferable to displaying fallback copy because a
  provider silently ignored JSON mode.
- Model evaluation can be wrong. The UI shows the criterion and its evaluation
  rather than treating verification as permission or execution authority.
- Model selection for auxiliary work is an injected seam but is not yet a user
  setting. Both paths use GLM 5.3 Flash in the current composition.
