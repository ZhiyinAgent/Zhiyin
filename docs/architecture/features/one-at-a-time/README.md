# One at a time

## Purpose

Work run one piece at a time, in the order it was asked for, so two changes
to one file, one credential or one folder never cross. The session, recovery,
memory, the credential store, the connections, the studios, the browser and
the core's folder chooser each need it, and features may not import each
other. It is a pure package (ADR 0002): it holds the order of work in memory
and does nothing else.

## Boundaries

- **Owns:** the order in which pieces of work start, alone or one line per
  key, and waiting for what was asked to settle.
- **Does not own:** the work itself, what it writes, or how a failure is told
  to anyone (each caller).
- **Talks to other packages only through:** the classes below. It imports
  nothing.

## Public interface

- `Serial`: `run(work)` runs `work` once everything asked of it before has
  settled, and answers what `work` gives; `settled()` settles once everything
  asked for so far has.
- `SerialByKey`: `run(key, work)` does the same per key, and work under
  different keys runs side by side; `settled(key)` settles once nothing under
  `key` is waiting or running, including work asked for while it waits. A key
  is let go of once its last piece settles, so keys that come and go are not
  kept.

## Invariants

- A piece starts only after the one asked before it has settled, in the
  order asked.
- A piece that fails fails its own caller only; the next piece still runs.
- Work under different keys does not wait for each other.
- Waiting for a key to settle waits for work asked for under it meanwhile.
- It imports no Node module and no npm package. Lint enforces it.
