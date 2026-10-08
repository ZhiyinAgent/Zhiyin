# 0004. The programs Zhiyin starts live in a Job Object

Status: accepted

## Decision

- **Containment comes before the first instruction.** A program is created
  suspended, assigned to a Windows Job Object, and resumed only once the
  assignment has succeeded. Everything it starts afterwards, detached or not,
  is in the same Job Object. A document process, which Electron starts as a
  utility process, is assigned before it is sent anything (ADR 0018).
- **The tree ends with its owner.** Closing the Job Object ends every process
  in it. It is set to end its processes when its last handle closes, so the
  tree ends with Zhiyin however Zhiyin ends, including when it is killed
  outright.
- **A process inherits only what it is handed**: its standard streams and,
  when asked for, the ends of two pipes made for it that no other process can
  open. No other handle Zhiyin holds reaches it.
- **Limits act on the whole tree.** A Job Object can cap the memory each
  process in it commits, native allocations included. Output is measured while
  the program runs, and past its limit the tree is ended.
- **One platform package owns the mechanism.** Shell commands, ripgrep, git,
  the browser, the document compiler, the Python environment and the document
  processes all run through it. A run whose container cannot be opened or
  assigned fails rather than running uncontained, and the shell is not offered
  where containment is unavailable.
- **Two Windows programs run without a Job Object.** PowerShell asks Windows
  whether a file would go to the Recycle Bin, and is stopped after 30 seconds.
  Windows' own `tar` unpacks a toolchain download once its checksum matches. A
  run without a Job Object is ended by walking its process tree.

## Why

A program Zhiyin starts can start others, detach them, and outlive the code
that would clean up after it: a dev server, a build watcher, a browser, a
drawing process stuck in native code. Ending the direct child leaves the rest
running. A Job Object is a kernel object: it holds the tree even when Zhiyin is
gone and runs no code.

## Rejected

- Walking the process tree at stop time (`taskkill /T`) as the mechanism: a
  point-in-time sweep misses a descendant started during it, and does nothing
  when Zhiyin itself ends. It remains the cleanup for a run without a Job
  Object.
- Each feature starting and cleaning up its own processes: the copies drift,
  and a surviving process is invisible from the feature that left it.
- Inheriting every inheritable handle, Node's default: a contained process
  would hold handles it was never meant to have.

## Assumptions

- Windows keeps the Job Object guarantees as documented: assignment covers
  descendants, and a job set to kill on close ends its processes when its last
  handle closes.
- A process that registers itself as a service, or asks another process to
  start something for it, is outside the tree. Containment bounds what Zhiyin
  starts, not what the machine does.
- The two programs run without a Job Object are Windows' own, run with fixed
  arguments, and start nothing that outlives them.
