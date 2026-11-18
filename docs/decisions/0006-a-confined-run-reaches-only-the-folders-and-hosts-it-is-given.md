# 0006. A confined run reaches only the folders and hosts it is given

Status: accepted

## Decision

### Folders

- **LaTeX, Blender and Python run in a Windows AppContainer.** Each is
  started suspended inside its Job Object (ADR 0005), and everything it starts
  runs in the same container.
- **A run reaches only what it is given.** It names the folders the program
  may read, the folders it may change, and the hosts it may reach. Windows
  refuses the program every other file the person keeps, for reading as for
  writing. Besides those folders it reads what Windows keeps open to every app
  container: Windows' own files and the fonts installed for everyone.
- **What each is given:**
  - LaTeX reads the workspace, its own installation and the shared package
    cache, and changes only the folder of its compile.
  - Blender reads its installation and the session script. It changes the
    workspace and, in the conversation's folder, its home, its render cache,
    its previews and its pictures. It reads the rest of that folder, where its
    settings, scripts and add-ons are, emptied before each start; USD packs a
    file only where it may look at every folder above. It starts in its home.
  - Python reads Zhiyin's own interpreter, the environment and the code it
    runs, and changes the workspace.
- **Each run has a home of its own.** The program's user folder, application
  data and temporary folder are in a home the run is given, so a program that
  asks Windows where the person's folders are gets folders it may use, and
  nothing one run leaves there reaches a run given another home. A LaTeX
  compile's home is inside its compile's folder; a conversation's Blender keeps
  one in the conversation's folder, so its compiled shaders last while the
  conversation does. Python scripts keep one for each workspace, apart for
  scripts that name hosts and scripts that do not, so what one without the
  network leaves is never read by one that could send it on. Each
  environment's installs keep a home of their own.
- **Each home has a container of its own.** Runs given the same home share an
  app container; a run given another home runs in another. The container is
  named after the purpose and the home's path, so a home that is gone can still
  name its container. A feature that removes a home for good removes its
  container with it: a LaTeX compile's when the compile ends or is cleared as
  abandoned, a conversation's Blender's when the conversation is deleted, a
  Python environment's install home's when the environment is removed. A
  container named after its purpose alone, which no home names, is removed the
  first time the purpose runs.
- **Blender and Python are given only the variables Windows programs
  expect** and those that say how this computer reaches the network, plus the
  ones Zhiyin sets for them. LaTeX keeps the person's environment, with its
  profile folders pointed at its home. No confined program is given a proxy
  variable but Zhiyin's own (below).
- **What the containers break is mended where the program starts.** A
  program that looks at each folder above the one it writes in cannot see
  those above the folders it is given. Zhiyin makes the OptiX cache folder
  before Blender starts, and has USD write in a folder of the conversation's
  deep enough that USD never looks above it, then moves the file. The
  Pythons Zhiyin runs make the folders Python makes private as Python did
  before 3.13, and name `multiprocessing`'s pipes where a container may.
- **Folders are reached through capabilities.** A container reaches nothing
  by itself. Each folder has a capability for reading it and one for changing
  it, and a run holds only those of the folders it is given.
- **A folder is granted once and stays granted.** Granting adds an entry for
  the capability to the folder's permissions, which Windows hands on to
  everything in the folder and to what is added to it later. A folder is
  granted again on the first run of each app session that names it, which
  also reaches files moved in since, and whenever it has lost its entry, as
  one removed and made again at the same path has. The entry stays when Zhiyin
  is gone: it lets in only a container holding the capability, which only a
  program already running as the person can start.
- **A grant a run waits for goes first.** Grants are written one at a time. A
  folder that already carries its entry is granted again behind the run, once
  the run's own new folders are granted, and a grant a run waits for goes
  before any grant behind a run that has not started.
- **A whole drive, or a folder that holds the person's user folder, is never
  granted**, and neither is a folder on a drive that keeps no permissions. A
  run that needs one is refused with the reason.
- **No integrity label is changed.** A folder is granted by its permissions
  alone. A file the program creates carries Windows' low label, as a file made
  by any low-integrity program does.

### Hosts

- **No app container is given the internet.** A confined run names the hosts
  it may reach instead: names such as `pypi.org`, or `*.` and a domain for
  every name below it, each with a port when it is not 443. A run that names
  none reaches no network. Hosts that are this computer or too wide are
  refused before the run starts.
- **A run that names hosts reaches them through a proxy in Zhiyin.** The proxy
  listens on a named pipe whose permissions let in only the person, Windows
  and the run's own container. Inside the container, a relay listens on the
  container's loopback and carries each connection to the pipe, and the
  program is given `HTTPS_PROXY` and `HTTP_PROXY` naming the relay. The relay
  is Windows PowerShell, given its script on the command line.
- **The proxy decides every host.** It takes HTTPS tunnels (`CONNECT`) to the
  hosts and ports the run names and refuses every other host, and plain HTTP,
  with a reason. It never reaches a loopback, unassigned or link-local
  address, named or resolved, and `localhost` is not a host a run can be
  given. It counts, for each host asked for, the tunnels opened and the bytes
  each way, or why it was refused or could not be reached.
- **It goes out the way Zhiyin's own requests do.** The composition root
  hands in Chromium's `resolveProxy` for the network session: the proxy takes
  the ways it names in order, an HTTP proxy, a SOCKS5 proxy or directly, so a
  proxy set for this computer is used as Zhiyin's own requests use it
  (ADR 0004). Directly, it connects to the address the name resolved to in
  Zhiyin.
- **Hosts by purpose:**
  - LaTeX reaches where its packages come from: `relay.fullyjustified.net`,
    the server it sends the bundle on to, and Zhiyin's copy of the bundle.
  - pip, installing a package the model asked for, reaches the package index,
    its mirror and the host that keeps their files.
  - A Python script reaches the hosts its call names, in `hosts`.
  - Blender, CAD builds and the scripts a feature runs in a kept environment
    reach none.
- **A script is told what it reached.** Its answer ends, after everything it
  printed, with each of the first hundred hosts it asked for and what went
  each way, or why it was refused; requests to further hosts are counted in
  one line. The person sees the same beside the action.
- **A script's hosts are approved as a set.** A script is decided by what it
  declares (ADR 0012). When it asks, its card names the hosts, and the person
  may allow, for the conversation, the scripts that reach the same hosts; a
  script that names others is asked about apart. A purpose's own hosts add no
  question.

## Why

LaTeX, a Blender script and a Python script open their files themselves, with
all the access the person's account has unless the operating system says no.
Reading a script's text before it runs corrects the paths it can see, and
cannot see one handed over by `setattr`, through another name, or built while
the script runs. Blender on Windows takes a path with no drive letter from the
root of the drive, so a script saving to `textures/…` writes `C:\textures\`
unless something refuses it. Zhiyin says its work stays in the folders it is
given, so the limit has to be one no route goes round, and only the operating
system holds such a limit.

An AppContainer is the Windows mechanism that limits reading as well as
writing, for one program and what it starts, without changing the program.
Confined, Tectonic reads only what it is given, so the document compiler can
show LaTeX's output even when Tectonic's own list of what it read is missing,
as it is after any fatal error.

Windows gives every container a folder of its own in the person's profile,
which the container may change, and storage of its own in the registry. A
container shared by every run of a purpose would let a script without the
network, run unasked under the conversation's allowance, leave a workspace's
files there for one with the network, or in another workspace, to send on. A
container per home keeps those apart as the homes are.

Blender reads its user scripts folder at start, before Zhiyin's session script
runs, even with factory settings, and imports add-ons from it by name. With
the conversation's whole folder writable, one approved script could install
code that ran unasked at every later start of the conversation's Blender, in
whatever workspace the conversation moved to.

A Python environment reset or made again under its name loses its grant with
the folder; a session that still counted it as granted would let no script use
it until Zhiyin restarted. A large workspace's grant held behind a run must
not hold up the new folders the run waits for.

A confined script with the whole internet could send what it reads anywhere,
so nothing could limit it but asking, every time, with a question nobody can
answer well. A list of hosts lets the person see where a script's data can go
before it runs, and afterwards where it went, and a script refused a host
says so instead of failing in a way the model cannot read. The same lists
close what installing packages and compiling LaTeX can reach to the sites
they need.

The host limit has to hold whatever the program does, as the folders do. A
container without the internet capability cannot reach an address, resolve a
name, or reach Zhiyin's loopback, which Windows' loopback isolation refuses.
The only way out is the pipe, and the pipe opens to that container alone, so
a program that ignores the proxy, or a program of another run, reaches
nothing. What passes is decided outside the container, by the proxy.

The relay is needed because the programs speak to a proxy only over TCP, and
the only TCP a container has is its own loopback. Windows PowerShell is part
of every Windows installation, runs in a container, and reaches both sockets
and pipes through .NET, so no program is shipped for it. Its script travels on
the command line, so the relay reads and writes no file, and it holds no
authority: what it carries, the proxy has already decided. Asking Chromium how
it would reach each host makes a run's network follow the computer's
settings, PAC scripts and the system proxy included, without passing a
proxy's password into a container.

The cost is that these programs cannot use a file kept outside the folders
they are given: a scene cannot load a texture from Pictures, and a script
cannot open a spreadsheet in Downloads until it is copied into the workspace.

## Rejected

- Low integrity, with the workspace marked low: it limits writes only, lets
  every low-integrity program write in the workspace, and limits nothing on a
  drive without permissions.
- Correcting more routes in a script's text, and listing the drive's root
  after each script: it closes the routes seen so far and reports some of the
  rest. It is not a limit.
- Having Blender write in Zhiyin's data and copying the files into the
  workspace afterwards: a script that writes a file and reads it back by its
  workspace path would find nothing.
- A less-privileged app container (LPAC): Blender's OpenGL falls back to
  Windows' software driver there and Blender ends on its first EEVEE picture.
- Granting the container itself rather than capabilities: every run of the
  container would reach every folder any run of it was given.
- Taking a grant back after each run: two walks of the workspace per run, at
  about ten thousand files a second, for no change in what can reach it.
- One home, or one container, for every run of a purpose: a run could leave
  there what later runs load, such as Tectonic's settings, which name the
  server packages come from.
- A container per run: a run that never finished would leave a container
  nothing could name again, found only by reading Windows' registry. A home's
  path names its container whether or not the run ended.
- Taking the container's access off its own folder after making it: the
  registry storage and the named objects Windows keys to the container would
  still be shared.
- Leaving Blender's settings writable and emptying them before each start
  alone: a script could still change them for a session already running.
- Having Zhiyin open each file on the program's behalf: these programs open
  their files themselves.
- An internet switch on a run, asked about every time: it cannot say where a
  script's data goes, so the question cannot be answered well.
- A proxy reached on Zhiyin's loopback: Windows refuses a container its host's
  loopback, and exempting a container needs an administrator.
- A Windows Filtering Platform filter per container: it needs an
  administrator, and filters addresses, not the names a person approves.
- NVIDIA's OpenShell: its Windows support needs WSL 2, or a driver from an
  Insider build.
- A pipe made with its permissions by hand through Windows' own calls: Node
  would have to wait on each connection on a thread of its own. Node's own
  pipe server, with its permissions set by name once it listens, keeps every
  connection on Node's own loop.
- Multiplexing every connection over the pipes a process is started with: it
  works for one process only, and needs flow control of its own.
- Zhiyin's own executable run as Node for the relay: the packaged app turns
  `runAsNode` off (ADR 0001), and turning it back on would let any program
  that starts Zhiyin run code as it.
- A program shipped for the relay: Windows PowerShell is already there.
- Letting a script reach this computer's own addresses when it names them:
  Zhiyin's own servers listen there, and a container is kept from them by
  design.
- Passing the proxy variables of Zhiyin's environment, or a caller's, to a
  confined program: it would go round the proxy, and carry a proxy's password
  into a container.

## Assumptions

Measured on Windows 11 (22631) on 2026-10-17, with an RTX 4070 Ti SUPER,
Blender 5.2.2, Tectonic 0.17.0 and Python 3.13, and on 2026-10-18 for the
container's own folder and Blender's read-only settings:

- A process can be started in a container only once its profile is
  registered; a profile is created or deleted in about 5 ms.
- A container process writes in a folder granted to it whose label is
  unchanged.
- A permission entry for a capability lets in a container holding it and no
  other.
- Granting a folder takes about a second per ten thousand files it holds. A
  file moved into it keeps the permissions it had until the folder is granted
  again. The entry does not follow a junction out of the folder.
- A container may change its own folder in the person's profile, and a
  container under another name may not. Deleting a container's profile
  removes that folder.
- Windows sets a container process's local application data and temporary
  folder below the local application data it is given, whatever else its
  environment says.
- Blender renders with Cycles on OptiX and on CUDA and with EEVEE in a
  container, on NVIDIA graphics; other makers' graphics are not measured.
- Blender 5.2.2 starts, saves scenes and renders with its settings folders
  read-only to it, and runs nothing a script left in them at a later start.
  Its USDZ export fails without reading the conversation's folder.
- Tectonic starts only when its user folder holds the folders Windows names
  for application data.
- A container process cannot open the `NUL` device, nor create a named pipe
  outside `\\.\pipe\LOCAL\`. Python's `multiprocessing` works once its pipes
  are named there.
- A container process cannot look at the folders above those it is given.
  USD 0.26.3, as Blender 5.2.2 carries it, finds where to write by halving the
  folders of the path and stops at the first it cannot see; OptiX does not
  make its cache folder.
- Python 3.13 makes a folder asked for as private (mode `0o700`, as
  `tempfile` does) with permissions for the person alone, which leave out the
  container: the process cannot use the folder it made.
- cmd and PowerShell started by a confined Python are confined the same way;
  Git's bash does not start in a container.
- Drives without permissions and network shares are not measured.

Measured on Windows 11 (22631) on 2026-11-06, with Electron 44, Node 22.23,
Python 3.13, uv 0.12.15 and Tectonic 0.17.0:

- A program in an app container without the internet capability cannot
  connect to an address, resolve a name, or connect to a port on Zhiyin's
  loopback; it can connect to its own container's loopback.
- Windows lets a container open a named pipe whose permissions grant its
  container's SID, and refuses another container (`EPERM`). The permissions
  Node's pipe server is made with, set by name with `SetNamedSecurityInfoW`
  as a file object once it listens, hold for every instance it makes later,
  at once and one after another.
- Windows PowerShell 5.1 starts in an app container given no folder, with
  `-NoProfile -NonInteractive -EncodedCommand`, listens on the container's
  loopback and connects to the pipe. Starting it adds about 0.4 s to a run
  that names hosts; it carried 64 MB from a proxy on this computer at about
  680 MB/s.
- Python's `urllib`, pip, uv and Tectonic use `HTTPS_PROXY`; Python's `urllib`
  reports a refused tunnel as an error naming the status.
- Electron's `resolveProxy` answers in a PAC script's words, the ways
  separated by semicolons: `PROXY host:port;SOCKS5 host:port;DIRECT`.

Not measured: a corporate proxy that asks for a sign-in, which the proxy
cannot give, and programs that check certificates with Windows' own TLS,
which call the certificate's issuer directly to check revocation and fail
(`curl.exe` needs `--ssl-no-revoke`). The proxy sees the host asked for, not
what is sent, so a list narrows where data can go without proving nothing
leaves, and a shared host, such as a CDN, can carry others behind it.
