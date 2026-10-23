# Process ownership

## Purpose

Every process Zhiyin starts lives in a Windows Job Object and ends when the
app does, however the app ends. A command the agent runs, the agent's browser
or a document drawing process can start further processes and detach them. A
Job Object set to kill on close ends the whole tree when its last handle
closes, and Windows closes that handle even when Zhiyin is killed outright.
ADR 0005.

This is a platform package below the features, because the guarantee has to
hold for every process the app starts, and a leaked process is invisible from
inside the feature that leaked it. It also gives features one way to run a
program with a timeout, cancellation and bounded output, and one way to start
a process that reaches only the folders it is given (ADR 0006).

## Boundaries

- **Owns:** the Job Object a process tree lives in and its lifetime, starting
  a process inside one, the memory limit set on it, confining it in a Windows
  app container and granting that container folders, the shared way to run a
  program with bounded output, an exclusive file hold that Windows releases
  with its holder, and reading text in Windows' own code page.
- **Does not own:** which programs run, their arguments, timeouts or
  cancellation policy (the calling feature), or what a process may do
  (permission engine). Containment is about cleanup, not authority: beyond
  memory, run time and output size, nothing here limits what a contained
  process does unless its caller confines it, and which folders it is then
  given, and whether it may use the internet, is the caller's to say.
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
    normal priority, for long, heavy work. Given `confined`, made by
    `confine`, the process and what it starts run in an app container that
    reaches only the folders granted to it.
  - `contain(pid)` puts a running process, and everything it starts
    afterwards, in the container. It throws if it cannot.
  - `close()` ends everything inside. Calling it again does nothing.
- `runProcess(options)` runs one program from an argument list with a
  timeout, a cancel signal, an optional environment, and limits on the output
  kept and printed. Given containment, it launches through a container and
  ends the tree by closing it; without, it ends the tree by process id. It
  answers the exit code, the start and end of each stream, and why the run
  ended early (`timeout`, `stopped`, `outputLimit`) or could not start
  (`containment`, `confinement`, `start`). `onStart` hands over a way to
  read what the program has printed so far; `keep` hands over each stream
  whole, as a file. Given a `confinement`, it confines the program through
  its container; without containment such a run does not start, and answers
  `containment`, and when a folder cannot be given it answers `confinement`
  with the reason.
- `confine({ purpose, home, read, write, network })` grants the folders a
  program may read and those it may change, makes its home, and answers a
  `Confined` to launch with. The purpose, such as `latex`, and the home
  name the app container its runs share: runs given the same home share one,
  and a run given another home runs in another. The home stands in for the
  person's user folder: the program's settings, application data and
  temporary files go there. It rejects, saying why, when a folder may not or
  cannot be given.
- `forgetConfinement(purpose, home)` removes the container of a home removed
  for good, with the folder Windows keeps for it in the person's profile.
- `windowsEnvironment(given?)` answers the variables of an environment a
  confined program may be given: those Windows programs expect and those that
  say how this computer reaches the network, by name whatever their case.
- `printedText(bytes)` reads what a program printed as text, as a run's own
  output is read: as UTF-8 when it is UTF-8, otherwise in the console's code
  page.
- `ansiText(bytes)` reads bytes in the code page Windows reads text that
  names no encoding in, the ANSI code page, and `ansiCodePage()` names it.
  Both answer nothing where Windows cannot be asked.
- `holdExclusively(path)` opens a file only one holder can have, which Windows
  deletes when its holder goes. It answers the hold, `held-elsewhere`, or
  `unavailable` for any other reason.
- The types these take and return: `ContainedProcess`,
  `ContainedProcessOptions`, `ContainerOptions`, `ProcessPipes`,
  `ContainmentAvailability`, `Confinement`, `Confined`, `HeldFile`,
  `HoldAttempt`, `ProcessContainment`, `ProcessRun`, `RunProcess`,
  `LiveRun`.

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
- **A confined process reaches only the folders it is given.** It reads the
  folders it may read and changes nothing in them. It changes the folders it
  may change, what they held and what is added to them later. Windows
  refuses it every other file the person keeps, for reading as for writing,
  and what a junction in one of its folders leads to. Besides its folders, it
  reads what Windows keeps open to every app container, such as Windows' own
  files. What it starts is confined the same way.
- **A confined process reaches the internet only when asked.**
- **Its home is its own.** Its user folder, application data and temporary
  files are in the home it is given. A later run given that home finds what
  was left there; a run given another home cannot reach it.
- **Each home has a container of its own.** What a run leaves in the folder
  Windows keeps for its container, a run given another home cannot read. A
  home forgotten keeps no container in the person's profile.
- **Runs of one purpose share only what both were given.** A run reaches the
  folders its own confinement names, not those another run of the same
  purpose was given.
- **A folder is granted by its permissions alone.** Its integrity label stays
  as it was. Everything in it is reached, including a file or folder whose
  permissions Windows keeps apart from the folder's: one protected from them,
  or a file moved in from a folder whose permissions an older program wrote.
  Such an entry is given the grant's entry directly and keeps the rest of its
  permissions, protection included; nothing is written through a link, even
  one that takes an entry's place during the grant. The first time each
  session of the app gives a folder, the grant is written again, so a file
  moved in since is reached too. A folder
  that lost its entry, as one removed and made again at the same path has, is
  granted again whenever it is given.
- **A grant a run waits for goes first.** Grants are written one at a time; a
  folder that already carries its entry is granted again behind the run, and
  a new folder a later run waits for is granted before it.
- **A confined program is given no credential from Zhiyin's environment.**
  `windowsEnvironment` passes only what Windows programs expect and how the
  network is reached, so no key kept in a variable, and no variable naming a
  program's plugins or startup scripts, passes.
- **What may not be given is refused, saying why**: a whole drive, a folder
  that holds the person's user folder, a folder that is not there, and a
  purpose that cannot name a profile. Nothing runs.
- **A confined tree still ends when its container closes.**
- **The shared run path confines when asked, and never uncontained.** A
  confined run without containment does not start, and one whose folder
  cannot be given does not start either, saying why.
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

Confinement is tested on NTFS folders only. A drive that keeps no
permissions, such as FAT or exFAT, is refused before anything runs, but no
test reaches such a drive.

The tests run on Windows only. On another platform,
`containmentAvailability()` reports that containment is unavailable, and
callers must respect it.
