# Usage

## Purpose

Persists non-textual provider telemetry and produces renderer-safe summaries for
seven- and thirty-day views. It is separate from sessions because request
accounting has its own retention, aggregation, and failure behavior and must not
carry prompts or responses.

## Boundaries

- **Owns:** durable request-level token and provider-cost records,
  request-id deduplication, time-window aggregation, model mix, and activity
  series.
- **Does not own:** obtaining provider usage (model client), deciding when a
  request is made (agent loop), or rendering charts (renderer).
- **Talks to other features only through:** recording a provider usage event
  and returning aggregate usage state.

## Public interface

- `record(usage)` stores request id, model, token counts, optional
  provider-reported cost, and recording time. It accepts no prompt or response
  text.
- `state(now)` returns seven- and thirty-day aggregates or a clear state before
  the first request.

## Invariants

- Stored and aggregated data contains request accounting but no request or
  response text. The named test `aggregates request, token, cost, model, and
  daily activity without text` guards both the shape and the aggregates.
- What the provider read from and wrote to its cache is kept with each
  request, when it said. Named test: `keeps how much of each request the
  provider read from and wrote to its cache`.
- A repeated provider request id replaces its earlier record instead of being
  double-counted. The same aggregation test guards deduplication.
- Cost is provider-reported, never reconstructed from a stale local price
  table. Requests without cost remain visible and coverage is explicit. The
  named test `marks partial cost coverage and survives a restart` guards this.
- Telemetry storage failure never changes a completed model response into a
  failed task. The agent-loop test `does not discard a completed response when
  usage storage is unavailable` guards the cross-feature failure boundary.

## Testing notes

Tests use real temporary storage and fixed UTC dates. Aggregates are tested at
the boundary, including partial cost coverage and an empty history, without
asserting serialization details.
