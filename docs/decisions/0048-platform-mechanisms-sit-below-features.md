# 0048. Platform mechanisms sit below features

Status: accepted

Amends 0034's layer model.

## Context

ADR 0034 made every single-concept package a feature. That left no legal owner
for behavior several features need but cannot implement correctly on their own.
Process containment exposed the failure: `process-ownership` owned the Windows
Job Object, while five peer features independently declared its interface and
implemented launch, cancellation, output capture, and fallback spawning. Their
copies had already drifted from the owner's required atomic `launch` contract.

Putting the behavior in `contract` would violate ADR 0036: the contract is
vocabulary and contains no behavior. Making a group would also be false; these
features are not always used together and there is no joining workflow.

## Decision

Add a **platform** layer between contract and features. A platform package owns
one operating-system mechanism that features may use directly. It may import
only the contract. It does not own product policy, orchestration, or a
user-facing capability.

`process-ownership` is a platform package. It owns the process-container
interface and the shared spawn-with-containment implementation. Features may
import those definitions and behavior instead of redeclaring or copying them.
The composition root still supplies the live containment factory; it remains
wiring rather than process logic.

**Assumptions this decision depends on:**

- Platform packages remain mechanisms with no product policy or feature
  vocabulary.
- A mechanism has one owner. A second consumer extends that owner's interface;
  it does not copy the implementation.
- The computed package-layer lint rule remains the enforcement boundary.
- Windows remains the only supported runtime platform.

Rejected: putting executable helpers in `contract`, which breaks ADR 0036;
allowing feature-to-feature imports as exceptions, which makes the layer rule
advisory; and creating a process group, because no composed product capability
joins the consumers.

## Consequences

- The backend layers are contract, platform, features, groups, agent loop, and
  core, in that order.
- Features stay independently testable with the platform mechanism present,
  just as they already require the contract.
- A platform package carries a higher stability burden because every feature
  above it may depend on its mechanism.
- New platform packages require an ADR; this layer is not a general-purpose
  utilities drawer.
