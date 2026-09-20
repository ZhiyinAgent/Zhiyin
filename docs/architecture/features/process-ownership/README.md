# Process ownership

## Purpose

The platform mechanism for structural containment of processes Zhiyin starts. A
subprocess can start further processes, detach them, and outlive the code that
would have cleaned up after it; the shell tool and browser both create trees we
are responsible for. This sits below features rather than inside one of them
because the guarantee has to hold for every process the application starts, and
because its failure mode — surviving processes — is invisible from inside the
feature that leaked them.

## Boundaries

- **Owns:** the containment object a process tree lives in, its lifetime, and
  the truthful statement of whether containment is available at all.
- **Does not own:** argument construction, timeout values, cancellation policy,
  or what a process is allowed to do. It owns the Windows creation boundary only
  because assignment must precede the first instruction. Permission decisions
  belong to the permission engine.
- **Talks to other features only through:** the container interface below.
  Callers receive a container; they never learn how it is implemented.

## Public interface

- `containmentAvailability()` reports whether processes can be contained here,
  with a reason when they cannot.
- `openProcessContainer()` returns a container.
- `ProcessContainer.launch(...)` creates a process suspended, assigns it to the
  container, and resumes it only after assignment. Output destinations and the
  working directory are explicit.
- `ProcessContainer.contain(pid)` puts a process, and everything it starts
  afterwards, inside the container. It throws rather than silently failing.
- `ProcessContainer.close()` terminates everything inside. Idempotent.
- `runProcess(...)` is the one argv-based execution path for features that need
  bounded output, timeout and cancellation. It opens containment before launch
  and uses the container's atomic launch operation when containment is supplied.

## Invariants

- A process placed in a container, and every descendant it starts afterwards,
  is terminated when the container closes — including a descendant that
  detached itself. The named test `kills a detached grandchild started after
  containment` guards this, and starts the grandchild only after containment so
  that passing cannot be an accident of winning a race.
- **Containment survives our own death.** When the owning process is destroyed
  outright, with no exit handler and no unwinding, the contained tree still
  dies. The named test `kills a contained tree when the owning process dies
  abruptly` guards this against a real process killed with `taskkill /F` and no
  `/T`. This is the property a point-in-time tree walk cannot provide, and the
  reason the mechanism is a kernel object rather than a sweep.
- **The installed application keeps the same invariant.** Its browser carries
  the owning main-process id in its isolated profile name, so the application
  regression can distinguish that tree from every other browser on the
  machine. `does not outlive the application being destroyed` asks Electron
  for the main-process id, destroys that process without `/T`, and observes
  the marked browser tree disappear. The first version of that test killed the
  command-shell wrapper reported by the automation client, not Electron; the
  browser survived because the application had not been destroyed.
- A container that cannot reach a process refuses rather than reporting
  success: `refuses to contain a process that is not there`.
- A closed container accepts nothing further and closes harmlessly again:
  `refuses to contain anything after it is closed` and `closes without
  complaint more than once`.
- Availability is answered truthfully, so a caller that starts subprocesses can
  stay unavailable instead of running work it cannot clean up. The named test
  `reports whether processes can be contained here` guards this.
- A process cannot create a child before ownership exists. The named test
  `owns a reparented descendant before its first instruction can run` starts an
  immediate detached child, lets the direct owner exit, and proves closing the
  Job Object still terminates the reparented descendant.
- Shared process execution opens the same atomic container and closes it after
  the process answers, times out, or is cancelled. Named test: `runs a process
  through the shared contained execution path`.

## Testing notes

Every test here runs against real processes. A fake cannot establish this
feature's only interesting claim, which is about what the operating system does
to processes we are no longer able to talk to. The abrupt-death test spawns a
separate owning process precisely so it can be destroyed without our test
process dying with it.

These tests are also the ones most able to pass for the wrong reason. The
abrupt-death test was checked by removing containment from its fixture and
confirming it fails: without a container, the detached grandchild survives its
owner. Keep that property — a containment test that still passes with
containment removed is worse than no test.

The tests are Windows-only and skip elsewhere, matching where the mechanism is
implemented. A skipped suite is not evidence; on another platform the
availability report is what callers must respect.

## Deferred work

- Nothing here bounds what a contained process may do while it runs. Containment
  is about cleanup, not authority.
