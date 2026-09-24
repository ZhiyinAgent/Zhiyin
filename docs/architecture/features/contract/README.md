# Contract

## Purpose

Defines the exact vocabulary that multiple backend layers or the renderer must
agree on. It is a dependency root rather than a product feature: shared types,
closed runtime value sets, bridge commands, and cross-layer errors live here so
agreement is compiler-checked instead of conventional.

## Boundaries

- **Owns:** renderer/core messages, durable snapshot shapes, tool and model
  result vocabulary, command channels, bridge identity, and runtime values that
  more than one layer must validate identically.
- **Does not own:** behavior, persistence, validation algorithms, transport,
  orchestration, or values used by only one feature.
- **Talks to other packages only through:** its exported vocabulary. It imports
  no workspace package and every other layer may import it.

## Public interface

- Workspace, task, message, action, evidence, artifact, view, browser,
  capability, plugin, usage, model, reasoning, recovery, and user-input record
  shapes shared by the backend and renderer.
- Tool specifications, inspections, invocation results, ownership names, and
  workspace context shared across feature boundaries.
- The core API, application events, command names and channels, and preload
  bridge key.
- Cross-layer runtime values and failures whose spelling must be exact.
- `REASONING_EFFORTS` is the ordered closed effort universe; its union type is
  derived from that runtime tuple.
- `estimatedTokens(text)` is the one token estimate every layer measures by:
  UTF-8 bytes ÷ 3, close for Chinese and cautious for English. `utf8Bytes(text)`
  counts those bytes without building an encoded copy.

An export belongs here only when at least two layers must agree on it and no
single feature can own it. Convenience types and executable helpers stay with
their owner.

## Invariants

- The contract imports no workspace package. Named regression: `rejects the
  contract importing anything from the workspace`.
- Every command has one channel and every channel names a command. Named
  regression: the compile-time `EveryCommandHasAChannel` assertion and the
  command-boundary repository suite.
- Runtime value sets and their corresponding types are derived from one
  declaration when both are needed. Reasoning validation, provider filtering,
  persistence validation, and display ordering all consume the contract tuple.
- A text's size is counted as an encoder would count it, in any script. Named
  tests: `is counted in UTF-8 bytes whatever its script, as an encoder would`
  and `is estimated in tokens as a third of its bytes, rounded up`.
- New source modules stay below the repository line ceiling, and the existing
  oversized module may shrink but may not grow. Named regression: `pins
  oversized package files at their current size with no growth headroom`.

## Testing notes

Most guarantees are compile-time and repository-boundary checks. Consumers
still need behavior tests for what they do with a contract value; typechecking
proves shared spelling and shape, not policy or correctness.
