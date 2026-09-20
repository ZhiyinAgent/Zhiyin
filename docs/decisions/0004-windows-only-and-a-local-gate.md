# 0004. Windows only, and the gate is a local script

Status: superseded by 0041

## Context

Development and use are on Windows. There is no CI runner, and setting
one up would be work spent before there is anything to protect.

Electron renders identically across platforms, so the per-platform risk
here is not the UI — it is process handling and paths, which genuinely
differ.

**Assumptions this decision depends on** (revisit it if any changes):
- Development and use are on Windows only, for now.
- Other platforms remain a real future goal, not an abandoned one.

## Decision

Windows is the only platform that is built, tested and supported.
Correctness on macOS and Linux is not claimed, and nothing runs against
them.

This is a scope decision, not a licence to write Windows-specific code.
Platform-dependent behaviour still goes through an abstraction with the
other platforms' implementations present, even while unverified. The
expensive kind of Windows-only code is the kind that assumes a backslash
or a Win32 handle somewhere no abstraction covers, and that is what is
not allowed.

`scripts/gate.ps1` is the gate and the single definition of "green":
lint (including the feature-boundary rules), formatting, typecheck,
tests, and build. `-Full` adds packaging. The pre-commit hook runs it.
If CI is ever added, it calls the same script rather than restating the
checks, so the two cannot drift.

Process teardown is tested on Windows as an ordinary test that runs with
everything else — never skipped, never behind a flag. It is the
mechanism most likely to leak orphaned processes and, per ADR 0001, the
one the move to TypeScript made structurally weaker.

Rejected alternatives: a three-platform CI matrix, which needs a runner
and spends most of its cost on platforms with no users; a weekly
informational build on the other platforms, which was considered and
dropped as noise nobody would act on.

## Consequences

- Every check runs on the machine the app is developed on, which is also
  the machine it has to work on.
- macOS and Linux will break, and we will not know when. The port, when
  it comes, includes a debugging session of unknown length. This is the
  real price and it is accepted deliberately.
- The gate is only as good as the discipline of running it. The hook
  makes it the default, `--no-verify` makes it skippable, and there is
  no server-side backstop. That is the trade for having no runner.
- A slow gate is a gate people skip, so packaging sits behind a flag and
  runs before a release rather than on every commit.
