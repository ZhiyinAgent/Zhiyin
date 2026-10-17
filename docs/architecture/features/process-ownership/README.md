# Process ownership

## Purpose

Every process Zhiyin starts lives in a Windows Job Object and ends when the
app does, however the app ends. A command the agent runs, the agent's browser
or a document drawing process can start further processes and detach them. A
Job Object set to kill on close ends the whole tree when its last handle
closes, and Windows closes that handle even when Zhiyin is killed outright.
ADR 0004.

This is a platform package below the features, because the guarantee has to
hold for every process the app starts, and a leaked process is invisible from
inside the feature that leaked it. It also gives features one way to run a
program with a timeout, cancellation and bounded output, and one way to start
a process that may write only where it is let in (ADR 0028).

## Boundaries

- **Owns:** the Job Object a process tree lives in and its lifetime, starting
  a process inside one, the memory limit set on it, starting it at low
  integrity and opening a folder to such a process, the shared way to run a
  program with bounded output, an exclusive file hold that Windows releases
  with its holder, and reading text in Windows' own code page.
- **Does not own:** which programs run, their arguments, timeouts or
  cancellation policy (the calling feature), or what a process may do
  (permission engine). Containment is about cleanup, not authority: beyond
  memory, run time and output size, nothing here limits what a contained
  process does unless its caller starts it at low integrity, and which
  folders are then opened to it is the caller's to say.
- **Talks to other features only through:** the interface below. Callers get
  a container and never see how it is implemented.

## Public interface

- `containmentAvailability()` says whether processes can be contained here,
  with a reason when they cannot. A feature that starts processes asks first
  and stays unavailable when the answer is no.
- `openProcessContainer({ processMemoryLimit? })` returns a
  `ProcessContainer`:
  - `launch(options)` creates a process suspended, assigns it to the
    container, and only then lets it run. The working directory, output files
    and environment are explicit, and standard input is empty. Given a `pipes`
    function, it also creates two pipes between Zhiyin and the process, passes
    the process's handle values to that function to build the arguments that
    name them, and returns Zhiyin's ends as streams. Given
    `priority: "below-normal"`, the process and what it starts run below
    normal priority, for long, heavy work. Given `integrity: "low"`, the
    process and what it starts run at Windows' low integrity level: they read
    what the person can read and write only in folders opened to them.
  - `contain(pid)` puts a running process, and everything it starts
    afterwards, in the container. It throws if it cannot.
  - `close()` ends everything inside. Calling it again does nothing.
- `runProcess(options)` runs one program from an argument list with a
  timeout, a cancel signal, an optional environment, and limits on the output
  kept and printed. Given containment, it launches through a container and
  ends the tree by closing it; without, it ends the tree by process id. It
  answers the exit code, the start and end of each stream, and why the run
  ended early (`timeout`, `stopped`, `outputLimit`) or could not start
  (`containment`, `start`). `onStart` hands over a way to read what the
  program has printed so far; `keep` hands over each stream whole, as a file.
  Given `integrity: "low"`, it launches the program at low integrity through
  its container; without containment such a run does not start, and answers
  `containment`.
- `openToLowIntegrity(folder)` opens a folder to processes started at low
  integrity: they may write in it, in everything it holds and in everything
  put in it later. It throws, with Windows' reason, when it cannot.
- `ansiText(bytes)` reads bytes in the code page Windows reads text that
  names no encoding in, the ANSI code page, and `ansiCodePage()` names it.
  Both answer nothing where Windows cannot be asked.
- `holdExclusively(path)` opens a file only one holder can have, which Windows
  deletes when its holder goes. It answers the hold, `held-elsewhere`, or
  `unavailable` for any other reason.
- The types these take and return: `ContainedProcess`,
  `ContainedProcessOptions`, `ContainerOptions`, `ProcessPipes`,
  `ContainmentAvailability`, `HeldFile`, `HoldAttempt`, `ProcessContainment`,
  `ProcessRun`, `RunProcess`, `LiveRun`.

## Invariants

- **A contained tree ends when its container closes**, including descendants
  started after containment that detached themselves or outlived their
  parent.
- **Containment survives Zhiyin's own death.** When the owning process is
  killed outright, with no exit handler running, the contained tree still
  ends. This is why the mechanism is a kernel object rather than a sweep of
  the process tree.
- **A process cannot run before it is contained.** It is created suspended and
  resumed only after it is assigned, so its first instruction cannot start a
  process outside the container. If assignment fails, it is terminated.
- **A contained process inherits only what it is handed**: its output files,
  an empty input, and its own pipe ends when asked. No other inheritable
  handle Zhiyin holds reaches it.
- **Its pipes are its own.** Each has an unguessable name, one instance and
  local clients only, and Zhiyin opens the process's end before the process
  exists. If that open fails, so does the launch.
- **A process asked to run below normal priority does**, and one not asked
  runs at normal priority.
- **A process started at low integrity writes only where it is let in.** It
  writes in a folder opened to it, in what the folder already held and in
  what is added later, and Windows refuses it a write anywhere else. It reads
  what the person can read. A process not asked for low integrity writes
  where the person can. The shared run path starts a program at low
  integrity when asked, and never uncontained, where it cannot lower it.
- **Opening a folder twice changes nothing**, and a folder that cannot be
  opened is refused with Windows' reason.
- **A running process costs Zhiyin's own work nothing.** With up to 189
  running at once, Zhiyin goes on reading and writing its files, and each
  process's end is still reported with its exit code, as it happens, with no
  timer asking for it. Every running process shares one wait, held on one of
  the four threads all file work shares, plus one more thread for each
  further sixty-three processes, and each end is told whichever wait holds
  it. At 189, three waits, it waits on no more, so one thread is always left
  to file work: a process past them is not started, and the answer says
  why, until one ends. Should
  Windows make no event to wake the wait, waiting for a process fails rather
  than holding a wait nothing could wake.
- **Zhiyin quits while it waits for processes to end.** Electron's quit waits
  for the thread the wait is held on, so the wait is woken on the way out and
  not held again.
- **Arguments arrive exactly.** Each is quoted the way Windows splits a
  command line, so quotes, trailing backslashes, spaces and empty arguments
  arrive as given. A program path, folder, argument or environment variable
  holding a NUL character starts nothing: Windows would stop reading it there.
- **The environment is exactly what the caller gives**, or Zhiyin's own when
  it gives none, never with a model key Zhiyin was given: variables named
  `ZHIYIN_…API_KEY` are left out either way.
- **An uncontained run is ended by Windows' own `taskkill`**, named by its full
  path, so a program of that name earlier on the search path never runs.
- **A memory limit covers native allocations too.** A process in a container
  with `processMemoryLimit` is refused memory past it and ends; nothing
  outside the container is touched.
- **A container refuses rather than pretends.** Containing a process that is
  not there throws, and a closed container accepts nothing more.
- **Output is bounded while the program runs.** Past a byte limit across both
  streams, 64 MB by default, the run is ended with everything it started and
  says `outputLimit`. A contained run's output files are measured four times a
  second.
- **Bounding what is kept never loses what was written.** Only the start and
  end of each stream are held, with a marker where the middle was left out.
  When asked, each stream is also handed over whole, up to the output limit.
- **What a running program has printed can be read before it ends**, bounded
  the same way, contained or not.
- **Output is decoded as UTF-8 when it is UTF-8**, and otherwise in the
  console's code page, which is what Windows console programs write by
  default.
- **A run answers even when its output files stay held** for a moment after a
  stopped tree ends. Removing them is retried, and a folder left in the
  temporary directory is never the run's failure.
- **A held file is let go with its holder.** `holdExclusively` shares nothing
  but deletion and deletes on close, so a second holder is refused and a
  holder that dies, however it went, frees and removes the file. Any failure
  other than another holder is `unavailable`, never "held".

## Testing notes

Every test runs against real processes. A fake cannot show what the operating
system does to processes Zhiyin can no longer talk to. The abrupt-death test
starts a separate owning process so it can be killed without taking the test
runner with it, and it fails when containment is removed from that process: a
containment test must not pass without containment.

The tests run on Windows only. On another platform,
`containmentAvailability()` reports that containment is unavailable, and
callers must respect it.
