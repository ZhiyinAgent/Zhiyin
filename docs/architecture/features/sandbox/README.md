# Sandbox

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
  app container and granting that container folders, holding paths from
  app containers for a while, the shared way to run a
  program with bounded output, and reading text in Windows' own code page.
- **Does not own:** which programs run, their arguments, timeouts or
  cancellation policy (the calling feature), or what a process may do
  (permission engine). Containment is about cleanup, not authority: beyond
  memory, run time and output size, nothing here limits what a contained
  process does unless its caller confines it, and which folders it is then
  given, and which hosts it may reach, is the caller's to say.
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
  `containment`, and when a folder or a host cannot be given, or the
  network's relay does not start, it answers `confinement` with the reason.
  A confined run that names hosts answers `network`: each of the first
  hundred hosts the program asked for, with the tunnels opened, bytes sent
  and received, or why it was refused or could not be reached. Past a
  hundred, it answers `furtherHosts`: the requests to the other hosts
  refused, those that could not be reached, and the tunnels opened with the
  bytes they carried, counted together. `input` names a file the program
  reads as its standard input, in place of an empty one. A confined run may
  be given `openings`, each a `PipeOpening`: a variable that names to the
  program a pipe only its container may open, and what to do with each
  connection made to it; and `shownPorts`, ports the program listens on
  inside its container, each shown at an address on this computer while it
  runs, which its `LiveRun` answers as `ports`. A run that is not confined is
  given neither, and answers `confinement`.
- `openLoopbackProxy(hosts, route?)` opens Zhiyin's proxy on this computer's
  loopback for a program that is not confined, such as git run on a sealed-off
  shell's behalf: it tunnels to the hosts named and refuses the rest, and
  answers its `address`, what it `reached()` by host, what went to further
  hosts, and `close()`.
- A `ProcessContainment` may carry `route(url)`, which answers how this
  computer reaches a URL in a PAC script's words (`DIRECT`, `PROXY host:port`,
  `SOCKS5 host:port`): the way a confined run's proxy goes out. The
  composition root hands in Chromium's answer.
- `confine({ purpose, home, read, write, hosts })` grants the folders a
  program may read and those it may change, makes its home, and answers a
  `Confined` to launch with. `hosts` names what it may reach over HTTPS:
  `pypi.org`, `*.example.com` for every name below a domain, each with
  `:port` when not 443; none, it reaches no network. Only a run started by
  `runProcess` reaches them. The purpose, such as `latex`, and the home
  name the app container its runs share: runs given the same home share one,
  and a run given another home runs in another. The home stands in for the
  person's user folder: the program's settings, application data and
  temporary files go there. It rejects, saying why, when a folder may not or
  cannot be given.
- `forgetConfinement(purpose, home)` removes the container of a home removed
  for good, with the folder Windows keeps for it in the person's profile.
- `holdingContainer(purpose, home, work)` runs `work` with every process of
  the confined runs in the container a home's runs of `purpose` share
  suspended, those they start meanwhile included, and resumes them when it
  settles, also when it throws or is stopped. A confined run starts its
  program only when no hold on its container is under way. Holds on one
  container run one at a time; one rejects, running nothing, when a process
  in the container cannot be suspended. A process Windows is already ending
  runs no more of its code and is passed over, so a container whose commands
  keep starting short-lived processes is held every time.
- `mayGrantFolder(path)` says whether a folder can be given to a container:
  whether this account may change who opens it, which only an administrator
  may for Program Files and Windows' own folders.
- `removeUnusedContainers(purposes?)` removes Zhiyin's containers whose home
  is gone, of the purposes named or of all, and answers how many went. The
  app runs it as it starts.
- `windowsEnvironment(given?)` answers the variables of an environment a
  confined program may be given: those Windows programs expect and the
  certificates this computer trusts, by name whatever their case.
- `hostListProblem(hosts)` says why a list of hosts cannot be given, and
  `hostList(hosts)` answers it as a run is given it: each host once, in the
  form hosts are compared in, in order.
- `printedText(bytes)` reads what a program printed as text, as a run's own
  output is read: as UTF-8 when it is UTF-8, otherwise in the console's code
  page.
- `ansiText(bytes)` reads bytes in the code page Windows reads text that
  names no encoding in, the ANSI code page, and `ansiCodePage()` names it.
  Both answer nothing where Windows cannot be asked.
- `readOnlyHolds(directory, { replace })` holds paths from sealed-off
  programs for a while, keeping its journal in `directory`, written whole
  with `replace`, which waits a while for a program that holds it open: `hold(within, paths)` holds each
  `HeldPath` inside the folder programs are given, `read-only`, `in-place`
  or `tree`, and answers what was held, what could not be and why, and a
  `release()`; `heldAt(path)` says whether a sealed-off program is held now
  from writing a path; `restored` settles once what an earlier session left
  held has its permissions back.
- `windowsFiles()` answers the Windows calls made on files and their
  permissions, declared once for this package and the features above it:
  `open`, as `CreateFileW` opens; `openWithoutFollowing`, which opens an
  entry itself, never what a link in its place leads to; `entryOf`, whether
  an open entry is a folder and whether it is a junction or symbolic link;
  `finalPath`, where an open entry really is, as Windows names it by its
  handle; its permissions as text, by handle or by name; `read`, `replace`, `remove`
  and `move`, as `ReadFile`, `ReplaceFileW`, `DeleteFileW` and `MoveFileExW`
  do; and `message`, Windows' own
  words for an error with its number. It throws where Windows cannot be
  asked.
- The types these take and return: `ContainedProcess`,
  `ContainedProcessOptions`, `ContainerOptions`, `ProcessPipes`,
  `ContainmentAvailability`, `Confinement`, `Confined`,
  `ProcessContainment`, `ProcessRun`, `RunProcess`, `LiveRun`,
  `FurtherHosts`, `HostReach`, `WindowsFiles`, `Opening`, `PipeOpening`,
  `ShownPort`, `LoopbackProxy`.

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
- **A confined process reaches no network but the hosts it is given.** No
  app container is given the internet: it cannot reach an address directly,
  resolve a name, or reach Zhiyin's own loopback. A run that names hosts
  gets a relay inside its container, listening on the container's loopback,
  and `HTTPS_PROXY` naming it; the relay carries each connection to a proxy
  in Zhiyin over a pipe only that container may open, so a program in another
  container cannot use it. The proxy takes HTTPS tunnels to the hosts named,
  on their ports, and refuses every other host and plain HTTP, naming each in
  what the run reached. It names the first hundred hosts a run asks for and
  counts the requests to the rest together, so what it keeps of a run is
  bounded however many hosts the run asks for. A program that ignores the proxy reaches nothing.
- **A pipe opened to a confined run is its container's alone.** Its name is
  unguessable and its permissions give the run's container, and Zhiyin, the
  right to open it; a program in another container is refused it. It closes
  when the run ends.
- **A port shown is the container's, reached from this computer only.** A
  relay inside the container, started before the program, carries each
  connection made to the shown address on this computer's loopback to the
  port inside, over a pipe only that container may open; nothing else is
  given the container's loopback, and the address closes when the run ends.
- **The proxy never reaches this computer's loopback.** It refuses loopback,
  unassigned and link-local addresses, whether named or resolved, and
  `localhost` is not a host a run can be given. An address this computer has
  on its network, and any other private address, is reached like any other
  host the run is given. Going directly, it connects to the address the name
  resolved to here.
- **The proxy goes out the way this computer does.** Through an HTTP or SOCKS5
  proxy the route names, in order, falling to the next when one does not
  answer; directly when the route says so or none is given.
- **A confined program is told of no proxy but Zhiyin's.** Any proxy variable
  in what it is given is left out; one that names hosts is given the relay's
  address in its place.
- **Its home is its own.** Its user folder, application data and temporary
  files are in the home it is given. A later run given that home finds what
  was left there; a run given another home cannot reach it.
- **Each home has a container of its own.** What a run leaves in the folder
  Windows keeps for its container, a run given another home cannot read. A
  home forgotten keeps no container in the person's profile. A container's
  display name records its home, which is made before the container is
  registered; a container whose home is gone, or that records none, is
  removed by `removeUnusedContainers`, and registered again with the same
  identity if a run needs it, so the folders granted to it stay granted.
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
  `windowsEnvironment` passes only what Windows programs expect and the
  certificates this computer trusts, so no key kept in a variable, no proxy
  and its password, and no variable naming a program's plugins or startup
  scripts, passes.
- **What may not be given is refused, saying why**: a whole drive, a folder
  that holds the person's user folder, a folder that is not there, a purpose
  that cannot name a profile, and a host that is not one, is `localhost` or
  this computer's loopback, or is too wide, such as `*.com`. Nothing runs.
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
- **A run ended early has no exit code.** Ended at its deadline, by a stop or
  past the output limit, contained or not, it answers why and no exit code,
  whatever code Windows gave the process it ended.
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
- **A path held read-only is read and not changed by a sealed-off
  program.** It may not write, append to, delete, rename or replace it, and a
  folder held so takes no new entry and cannot be moved, while what it holds
  keeps the permissions it had; the rest of its folder stays writable. A
  path held in place cannot be moved or deleted, while what it holds can be
  changed and added to. A program given the folder reads a path held
  read-only even when the folder was never given before. A held path keeps
  its hold while a grant of its folder is written again, and is held as long
  as its last holder holds it. A deny entry is not used: Windows ignores it
  for an app container. The path is given permissions of its own in which
  every app container entry allows less, and every other entry stays.
- **A folder held as a tree is read whole and changed nowhere.** A sealed-off
  program may not delete, overwrite or rename anything in it, nor add a file
  anywhere in it, nor move it. The folder's entries for app containers,
  those it hands on included, allow only reading, and Windows writes that
  into everything below that takes from it; an entry with permissions of
  its own is held by itself. A grant of the folder it is in does not go into
  it. The folder is kept in place through the handle Zhiyin opened before its
  permissions are set by name, and is checked to be the same folder, so the
  setting never lands on what a link under its name leads to, and neither
  does putting them back. Where apps may remove what the folder it is in
  holds, it is not held, saying why, and keeps its permissions. On a copy of this repository's `.git`, about 4,600 entries, holding
  takes under two seconds and letting go under one.
- **A held path gets exactly its own permissions back.** What they were is
  written to the journal before they change; they come back when the hold is
  let go, or at the next start when Zhiyin stopped holding it, a tree cut
  short as it was being held included. They go back only to the same file,
  never to one that took its name since. Setting them hands nothing on to
  what a folder holds, but a tree's, whose contents then take theirs from it
  again, each exactly as before. A path that cannot be put back, or a folder
  whose hold as a tree failed and could not be undone, stays in the journal,
  however many holds come after, until it is put back: one on a drive that
  is not there is kept, and is dropped only once its folder is there and the
  path is gone. A hold goes ahead while another program briefly holds the
  journal open.
- **Whether a path is held agrees with what a sealed-off program may
  write.** A file held read-only, anything in a tree held whole, and a new
  entry in a folder held read-only are held; a file already in such a folder,
  and anything once the hold is let go, are not.

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
