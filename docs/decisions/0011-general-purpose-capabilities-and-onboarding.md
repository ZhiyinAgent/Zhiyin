# 0011. General-purpose work with optional capability defaults

Status: accepted

## Context

The owner confirmed on 2026-09-05 that Zhiyin targets nontechnical people across
many kinds of work and is intended for open-source distribution. A narrow
initial product category would contradict that direction. Raw MCP, skill, and
agent configuration is too much prerequisite knowledge for ordinary work.

## Decision

Present tasks and results as the primary experience. Offer an optional interest
selection that enables bundled skills, and group skills, connections, and
specialist definitions in a capability library. Preserve explicit management
and extensibility. Interest selection never grants external access.

Assumptions: people can express interests more easily than configure agent
internals; a small instruction catalog is useful before a package ecosystem;
general-purpose quality can be measured through representative workflows.

## Consequences

Users can begin broadly and change defaults. Enabled skills are advertised and
loaded explicitly during work. Specialist definitions remain unavailable for
execution until the runtime exists. Onboarding does not currently install MCP
servers or create executing specialists.

Breadth increases evaluation and support costs. Instructions alone cannot make
unsupported work possible. Package provenance, versioning, authentication,
updates, and source precedence require subsequent decisions. Onboarding choice
and retry behavior are guarded by the onboarding component tests; disabled
instruction loading is guarded by `does not load disabled instructions`.
