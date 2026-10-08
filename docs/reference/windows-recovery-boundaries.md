# Windows recovery boundaries

Process ownership, file recovery and rewind rest on a few Windows mechanisms.
This page says what each mechanism guarantees and where it stops. What the
features build on top is in their READMEs:
[process ownership](../architecture/features/process-ownership/README.md),
[recovery](../architecture/features/recovery/README.md) and
[rewind](../architecture/features/rewind/README.md).

## Job Objects end what Zhiyin starts

A Job Object groups processes so Windows can limit them and end them together.
Every container that process ownership opens is a job created with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: when the last handle to the job closes,
Windows terminates every process in it. Zhiyin holds that handle, so the
processes it put in the job end with it, even when Zhiyin itself is ended
abruptly.

- A program is created suspended, assigned to the job, and only then resumed,
  so it cannot start anything before it is inside.
- Children a contained process creates with `CreateProcess` join the same job.
  The job allows no breakaway, so a child cannot leave it.
- A container can cap the memory each of its processes may commit
  (`JOB_OBJECT_LIMIT_PROCESS_MEMORY`). A process that asks for more is refused
  the memory.

Where it stops:

- A process created through WMI's `Win32_Process.Create` is started by the WMI
  service rather than by a process in the job, so it is not in the job.
- A job controls the lifetime and resources of processes. It is not a
  filesystem or network sandbox, and ending a process does not undo what it
  already did.

Source: [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

## Share modes hold a file still

Whoever opens a file on Windows says what others may do with it while it is
open. An open that conflicts with a handle already held fails with a sharing
violation.

Recovery puts a file back under such a handle. It opens the file for reading
and shares only reading and deletion, so while the handle is held no other
program can open the file for writing; if one already has it open for writing,
the open fails and the file is left as it is. Recovery then computes the
file's SHA-256 through that handle, and only if it still matches what the
agent's work left does it swap in the kept copy with `ReplaceFileW` (or delete
the file, for one the work created). The handle is released afterwards. These
calls are made from Zhiyin's own process through `koffi`; no helper program is
started.

Where it stops:

- Deletion is shared because replacing or deleting the file needs it, so
  another program could rename or delete the file in that moment. It cannot
  write to it.
- A file the work deleted has no handle to take. It is made again from the
  kept copy, folder included, by moving the copy into place with
  `MoveFileExW`, which fails if anything has taken the file's place since.

Sources: [Creating and opening files](https://learn.microsoft.com/en-us/windows/win32/fileio/creating-and-opening-files)
and [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).

## Handles close when a process ends

Windows closes every handle a process holds when it ends, however it ends. Two
guarantees use this: a job's kill-on-close handle (above), and the lock that
lets only one copy of Zhiyin use a data folder. That lock is a file Zhiyin
holds open with no read or write sharing and marked to be deleted on close, so
a second copy's open fails, and the lock disappears with the process that held
it. Nothing records a process id that could go stale or be reused.

Rewind's own record of an operation in progress is an ordinary file, written
to a temporary name and then renamed into place. At startup, an operation found
there is finished before anything else runs; a conversation whose operation
cannot be finished stays closed to new turns, rewinds and undos, with the
reason shown (ADR 0009).
