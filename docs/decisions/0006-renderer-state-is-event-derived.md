# 0006 — Renderer state is event-derived and phase-safe

**Status:** accepted

## Context

The renderer must show a task while it moves through drafting, execution,
permission, browser use, completion, failure, and interruption. Independent
booleans for those states can contradict each other and cannot reliably
rehydrate after a window reconnects.

The component lab also became part of the product workflow. A separately
implemented mock would drift from production even if it looked correct when it
was created.

## Decision

- Each task has exactly one phase from a discriminated union. Data that belongs
  to a phase lives inside that phase.
- Task selection is stored as an id. The selected task and its context are
  derived during rendering rather than duplicated in state.
- The backend event stream remains authoritative. Renderer actions may update
  an optimistic view, but the complete view must be reconstructible from a
  backend snapshot plus subsequent events.
- The component lab is an executable catalog of production React components.
  It may supply fixtures and local callbacks; it may not reimplement a product
  component.
- Loading placeholders preserve the expected content shape. They never claim a
  step is running or completed.

## Assumptions

- Zhiyin remains a single-window local desktop application for now.
- The contract will grow beyond the core-ready handshake to provide snapshots,
  commands, and events for the states the renderer already models.
- The component lab is a development and review surface, not a user-facing
  route in packaged builds.

## Consequences

- Impossible task-state combinations are excluded by the type model rather
  than repaired in components.
- Reconnecting a window does not depend on renderer-local history once the
  snapshot contract is implemented.
- A reusable component change is visible in the lab automatically because the
  lab imports the production component.
- The renderer can be integrated before backend features are complete, but
  unavailable persistence, execution, or telemetry must remain visibly
  unavailable rather than being simulated in production.
