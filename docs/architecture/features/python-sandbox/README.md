# Python environment

## Purpose

Runs Python for data work in environments Zhiyin manages, kept apart from the
person's own projects. Analysis gets somewhere to run that cannot disturb a
workspace project's dependencies, and installing a package is an explicit,
visible step. People see it as the Python environment.

A `default` environment holds the usual data stack. The model can make others,
each with its own Python version and packages, for work that needs another
Python or packages that would clash with the default's. Environments are kept
between conversations, and every conversation can use each of them. Another
feature can have the sandbox keep an environment for it, as the CAD studio has
its `cad` one (ADR 0023): like the default, Zhiyin keeps it from a lock, which
the feature provides, and the feature runs it through the sandbox. It is made
as the feature's connector is installed, never by a call (ADR 0023).

A script runs confined (ADR 0006): it reads and changes only the workspace,
and the folders outside it that its call names and the person approves, and
reaches on the network only the hosts its call names (ADR 0006). Installing a
package runs confined too (ADR 0020): what the package's own code does while
it installs reaches only its environment and the package index.

## Boundaries

- **Owns:** making, rebuilding and removing environments, running a script in
  one, adding packages to one, and keeping every `uv` command away from the
  workspace's own project files.
- **Does not own:** installing `uv` (toolchains), permission decisions, or the
  connection's lifecycle (MCP).
- **Talks to other features only through:** the contract's
  `OfferedConnection`, which `pythonConnection()` in the capabilities group adapts into a built-in
  connection the MCP feature serves, and `KeptPython`, which the composition
  root hands to a feature it keeps an environment for. It knows no other
  feature's environment: each is handed in as a `KeptEnvironment`.

## Public interface

- `pythonSandbox({ workspaceRoot, directory, uv, containment?, run?, lock?, ... })`
  returns an `OfferedConnection`: `listTools`, `callTool`, `inspect`,
  `describeResult` and `close`.
- `pythonSandboxes({ directory, uv, ... })` returns a function that makes a
  connection from a folder getter, `(workspaceRoot) => OfferedConnection`,
  read on every call. Each runs scripts in the folder it reads, and all share the one set of
  environments: two folders' first runs make the default environment once.
- `keptEnvironments`, an option of all three, lists the environments other
  features keep here, each a `KeptEnvironment`: its `name`, its `lock`, the
  `installedBy` connector and plugin as the Plugins page names them, and
  `takesNoPackages`, the words a call that asks to add a package is refused
  with. The default environment is the sandbox's own.
- `pythonPrograms`, the programs the sandbox needs installed before it can
  run: uv.
- `pythonEnvironments({ directory, uv, ... })` returns that function as
  `connection`, and `kept`, a `KeptPython` through which Zhiyin's own
  features run the environments it keeps: `state(environment)` says whether
  one is ready, or unavailable: not made, made from an earlier lock, or
  without uv;
  `run({ environment, arguments, cwd, read, write, home, homeLastsOneRun?, timeoutMs, maximumOutputBytes?, signal? })`
  runs its Python on the arguments, with
  `home` as its home: the feature says where, and so how long it is kept.
  `homeLastsOneRun` says the home is that run's alone. `maximumOutputBytes`
  is how much it may print before it is stopped, the process layer's own
  limit when left out.
  `installation(environment)` is a `KeptInstallation`, how the connector
  that uses one makes it: `state()` answers as a program's install does,
  ready, missing with what installing downloads, installing with the step it
  is on, or failed with why; `install(signal?)` makes it, and the signal
  stops it.
- Six tools:
  - `run_python`: code, or the workspace-relative path of a `.py` file, with
    arguments, `hosts` it may reach, and `environment`.
  - `install_python_package`: packages, and `environment`.
  - `create_python_environment`: a name, a Python version, and packages.
  - `list_python_environments`.
  - `remove_python_environment`: a name.
  - `reset_python_environment`: `environment`.

  A call that names no environment uses `default`. Adding packages, or making
  an environment with some, shows each package and the environment in words,
  then the command that installs them.
- `defaultPackages` is what the default environment asks for: pandas, polars,
  NumPy, SciPy, Matplotlib, seaborn, statsmodels, and openpyxl for Excel
  workbooks. `defaultLock`, a `PackageLock`, pins those and what they need to
  one version each, as published by `defaultPackagesPublishedBy`, with the
  SHA-256 of every file of each version (ADR 0020). It names the Python too,
  3.13, which is also that of an environment made without naming one. A
  script beside the package writes the lock with uv, run by hand with a
  release when the date moves. Beside each locked package it records the size
  of the file uv installs of it for the lock's Python and platform, and the
  size of the Python build the pinned uv downloads. The `lock` option
  replaces it, for tests.
- Programs run through the sandbox platform (ADR 0005). A script
  may run for five minutes and print 64 MB; each step of making an
  environment or installing into one may take fifteen minutes. The tools'
  descriptions state these limits, and an answer at one names it and what to
  do instead: split the work over runs, print less, or ask for fewer
  packages at once. Scripts and installs run only confined, so without
  containment they do not run. Tests may replace the runner.
- The types these take and return: `ProgramContainer`, `ProgramContainment`,
  `ProgramRun`, `RunProgram`, `PythonSandboxOptions`, `PackageLock`,
  `KeptEnvironment`, `KeptPython`, `KeptPythonRun`, `KeptInstallation`.

## Invariants

Environments:

- The default environment is made on first use, by a script or an install
  that names it. Making it deletes the single environment kept before
  environments had names.
- An environment is named by up to 32 lowercase letters, digits and dashes,
  starting with a letter, and never by a name Windows keeps for a device. Its
  Python is one of 3.11, 3.12, 3.13 and 3.14, the versions Python's developers
  still support, by minor version; any other is refused, naming these,
  before anything runs. `default` cannot be created or removed;
  resetting rebuilds it. A call that names an environment any other way, a
  path included, finds none, even where one would be found at that path, and
  nothing runs.
- An environment is either whole or as it was: one already there is set
  aside while it is made again, and let go of only once the new one is whole.
  When making it or installing its first packages fails, what was made is
  deleted, the old one is put back where it was, and the call says why. One
  still in use, as by a running script, is not made again. When the app
  stopped partway through making one, its next start puts the old one back.
- Resetting an environment rebuilds it with the Python and packages it was
  made with, so packages added since are lost, and other environments are left
  as they are.
- One change of an environment runs at a time: two calls never make, install
  into, reset or remove the same environment at once, and two scripts that
  find the default environment missing make it once.
- Listing reads each environment's Python version and installed packages from
  its files, running nothing, and says when the default environment is not
  made yet. Listing and changing environments need no workspace; running a
  script does.

The environments Zhiyin keeps for its features:

- **An environment another feature keeps is made only by its
  installation** (ADR 0023), from its lock, as the default is: wheels only,
  each file checked against its SHA-256, with the same mirrors, and set aside
  and put back as any environment made again. No script, install or run for
  a feature makes it: until it is made, a script asked to run in it, and a
  reset, are refused, saying that installing its connector, from its plugin,
  makes it, and a feature's run is refused with nothing downloaded. It cannot
  be created or removed by name; once there, resetting rebuilds it from the
  lock.
- Before it is made, its installation says what installing downloads: the
  Python build the lock names, unless the sandbox keeps a Python of that
  minor version, with its size, and the locked packages, as the first package
  asked for with the rest named beside it, at the size of the files the lock
  installs, marked as an estimate, each with the hosts it comes from, the
  mirrors included. While it is made, it says which of its three steps is
  under way: setting up Python, installing the packages, preparing them. A
  failure is said until it is tried again; a stop is not a failure.
- **Such an environment made from an earlier lock is out of date**, since
  its feature needs exactly the versions its lock pins. It is not run, and no
  call makes it again; its installation says that installing it is an
  update, and the list of environments says that updating the connector
  makes it again. One made before Zhiyin kept one by that name is the
  person's: the list says so, with its Python and packages, and that
  installing the connector replaces it. Nothing is added to it: a call that
  asks is refused with the feature's own words.
- The default environment made from an earlier lock keeps working, with the
  packages added to it, until the person resets it; the list says that a
  reset brings this release's versions.
- A feature runs a kept environment only through `kept`, only one Zhiyin
  keeps, and only once it is made from the lock Zhiyin ships. The run is
  confined: it reads Zhiyin's Python, the environment and
  the folders it is given, changes only the folders and the home it is
  given, and reaches no network. What it printed comes back without the warning
  Python prints on every confined start. Where its home lasts one run, what
  Windows keeps for that home in the person's profile goes when the run ends.

Making environments and installing:

- Every Python is one uv downloads into the sandbox's own folder, never
  another Python on the PC, the person's own uv Pythons included. No uv
  settings file around the sandbox's folder applies, and making an
  environment puts no program among the person's own.
- uv makes environments, with pip in each as published by the lock's date,
  and installs the default packages into a new default environment as wheels
  only, so none of their own code runs, and only as the lock pins them: each
  file is checked against the SHA-256 the lock keeps for it, so a file that
  differs fails the install, which leaves no default environment, and every
  install and reset of it holds the same versions. Their files are
  then compiled once, by Python reading no settings and no package's startup
  file, since a script may not keep what it compiles in the environment. It
  runs with the sandbox's folder as its working directory, so a
  `pyproject.toml` in the workspace never decides what an environment holds.
  Packages are copied rather than linked to uv's cache, so scripts can read
  them.
- **A package the model asks for is installed by the environment's own pip,
  confined.** pip reads Zhiyin's Python, changes only that environment, and
  reaches only the package index, its mirror and the host that keeps their
  files. Whatever the package's own code does as it installs, Windows refuses
  it every other file the person keeps.
- **A step that downloads is run again from mirrors when what it downloads
  from cannot be reached** (ADR 0027): making an environment, installing the
  lock and installing what the model asks for. A step is run again when uv or
  pip says a site did not answer, or it ran out of time; a step that failed
  for another reason, or was stopped, is not. The second run takes Python
  from npmmirror's copy of python-build-standalone, which uv checks against
  the fingerprint it keeps for each build, and pip and every package from
  Tsinghua University's copy of the Python Package Index, the lock's hashes
  still required. A rebuild whose second run fails too leaves the
  environment as it was.
- Each environment's installs keep a home of their own, apart from every other
  environment's and from the scripts', so nothing one package's install leaves
  there reaches another environment. Removing an environment removes the
  container its installs ran in.
- An environment reset, or removed and made again under its name, can be used
  by scripts at once, in the same session of the app.
- A package is named by name, optional extras and version only, starting with
  a letter or a digit. Anything else is refused before anything runs, so a
  call cannot change the package index, pass options or install from a path.

Running scripts:

- A script runs with the workspace as its working directory, through its
  environment's interpreter, so it works on the person's files with that
  environment's packages. A script that names an environment that does not
  exist is refused before anything runs.
- **A script reaches only the workspace.** It reads Zhiyin's Python, its
  environment and the code it was given, and changes only the workspace.
  Windows refuses it every other file the person keeps, for reading as for
  writing, and a program it starts, a shell included, is held to the same
  limits. It reaches on the network only the hosts its call names, over
  HTTPS through Zhiyin's proxy; every other host and plain HTTP are refused.
  Hosts that are not a list of hosts, or are this computer or too wide, and
  a call that asks for the internet without naming hosts, are refused before
  anything runs.
- **A script that names hosts is told what it reached.** Its answer ends,
  after all it printed, with each of the first hundred hosts it asked for:
  what it sent and received, or why it was refused or could not be reached.
  The requests to further hosts are counted in one line after them, so the
  section stays short however many hosts a script asks for. The person sees
  the same beside the action. A script that names no hosts has no such
  section, so nothing it prints passes for one.
- **A folder outside the workspace is given only as approved** (ADR 0012).
  A call may name folders outside the workspace for the script to change
  too, each by its whole path; the approval names each and says it is outside
  the folder the person selected, and such a script is allowed by those
  folders, each declared for Zhiyin to copy before it runs.
  Each must be there and reached through no link, checked again when it
  runs, so the folder approved is the folder given. A folder inside the
  workspace is the workspace's. Zhiyin's own folders, a folder holding one,
  a drive, the person's user folder and a folder holding it are refused
  before anything runs.
- **No script can change another's code before it runs.** Code passed as text
  waits in a folder of the sandbox's that scripts may read and not change,
  never the workspace, and is removed after the run.
- **Scripts that name hosts and scripts that do not keep homes apart.** Each
  has a home in the sandbox's folder for each workspace, kept between runs, so
  what one that reaches no network leaves there is never read by one that
  could send it on, and nothing one workspace's scripts leave reaches
  another's.
- **Python's own library works confined**: a `multiprocessing` pool runs, the
  temporary folders Python makes are usable, and pip unpacks and builds a
  package published only as source. A container may not open `NUL`, so what a
  script writes to `os.devnull` or a program's `DEVNULL` output is read and
  dropped through a pipe, kept nowhere, and reading either ends at once. A
  shell's own `> nul` still fails there. `os.path.realpath` finds a path's
  real place, the Python's own included, which an environment names through
  the link uv keeps for its minor version: a run reads the folder all of
  Zhiyin's Pythons are in, not only the one it runs on, since through a link
  whose folder it cannot read a real path is wrong and slow to look up. What
  makes this work is a Python file that every environment runs as it starts;
  it changes private parts of Python's library, so it holds on each Python an
  environment may use.
- Only a `.py` file is run, and a call that gives neither code nor a file is
  refused.

What is said:

- A failure reports what the run, the build or the install printed, with the
  exit code. The whole output is passed on, so a traceback at the end
  survives; how much of it the model sees is decided where every tool's answer
  is sized. Python's warning, on every start in a container, that it cannot
  find where its own program lies is left out.
- A script that did not finish says why: past its time limit or its output
  limit, each with what to do instead; stopped with its task; or ended from
  outside with no exit code. One Windows ended for a crash names the code and
  what it means, such as an access violation. One that failed for a module
  its environment lacks points to `install_python_package` and
  `list_python_environments`.
- An install says what it changed in the environment, measured from the
  packages the environment holds before and after, not from what pip says:
  the packages installed with their versions, those that came with them, those
  whose version changed, those removed, the packages asked for that were
  already there, and those asked for that the environment does not hold
  after. One that changed nothing says nothing was installed. A failed one
  leads with pip's exit code and whether the environment holds the same
  packages as before, or else what changed in it.
- `run_python` tells the model, before it runs anything, that each run starts
  fresh, how long a run may take, that its home folder (`~`) is Zhiyin's own
  for scripts, so results go in the workspace or an outside folder named,
  that no window can open, so a figure is saved as a PNG in the workspace and
  looked at with `read_document`, and that it runs in Zhiyin's environments,
  not a project's own. Matplotlib draws off screen.
- Python reads and writes UTF-8 whatever the console's code page. Python, pip
  and `uv` are given only the variables every confined program is: those
  Windows programs expect and the certificates this computer trusts, so no
  variable points them at another environment, package index, proxy or
  startup script, and no credential kept in a variable reaches a script.
- With no `uv` installed the connector offers no tool, and it offers all six
  as soon as `uv` is installed.
- The approval says what a call will do and names where it is sent: the
  package names an install, or an environment made or reset with packages,
  lists go to pypi.org, or to pypi.tuna.tsinghua.edu.cn when pypi.org cannot
  be reached. A script is sent nowhere, and nothing of a call goes to where
  Python comes from: that making an environment can download Python from
  releases.astral.sh, or from github.com through
  release-assets.githubusercontent.com, and pip from pypi.org through
  files.pythonhosted.org, and from registry.npmmirror.com through
  cdn.npmmirror.com and from pypi.tuna.tsinghua.edu.cn when those cannot be
  reached, is said as what making it does. When a script or an
  install is the first to use the default environment, its approval says that
  the environment is made first, and where from. Installing says that a
  package's own code can change only its environment and reach only the package index. Running a script names its environment unless it is
  the default, and says that it reads and changes only the workspace, or
  which folders outside it as well, and the hosts it can reach, or that it
  reaches no network. Rebuilding the default environment says
  that its packages are the versions Zhiyin pins, each checked against the
  SHA-256 Zhiyin keeps.
- Scripts that reach no network, in any environment, are named as one set
  the person could allow for the conversation, and scripts that reach the same
  hosts as another; a script naming other hosts is in another set. No grant
  covers one that first makes the default environment, which downloads, or
  any change to an environment. One that names files in `change_locked` is never
  in that set: it is asked about, and allowed for the conversation by each
  file it changes without a backup (ADR 0013). One that changes folders
  outside the workspace is never in that set: it is allowed by its folders.
  Listing can be allowed for the conversation. The set matters only for a
  call that asks: each call is decided by what it declares (ADR 0012), so a
  script that changes only the workspace runs without asking, one that names
  hosts asks only once outside content and something private meet in the
  conversation, and installing, creating or rebuilding an environment asks
  every time.
- Each call declares what it does (ADR 0012). A script runs confined, reads
  the workspace, or elsewhere too when it is given folders outside it, and
  may change any file in the workspace and in those folders, which Zhiyin
  copies before it runs and can put back: given such folders, it changes
  elsewhere. A file it could not copy is read-only to the script for that
  run; a call that names such files in `change_locked` changes them for
  good, and its approval names them. A path there must stay in the
  workspace, or be a whole path inside a folder outside it the call is
  given, and keep out of Git's folder, or the call is refused; it sends where it chooses when
  it names hosts, and only to the fixed download sites when its
  environment is made first. Installing, creating or rebuilding an
  environment changes Zhiyin's own records from those fixed sites and leaves
  code that every later script in it runs; a package the model named runs
  its own code, confined, as it installs. Removing an environment and
  listing them touch only Zhiyin's own records.
- A script's approval shows its code as what runs, the workspace file it
  comes from, then its arguments as a
  command line has them, each with a space, a quote or nothing in it quoted,
  and its environment when that is not the default one.
- A script to run is shown whole, with its line breaks, however long. A call
  gives code or a `.py` file in the workspace, not both; blank code is none.
  A script whose first or second line declares an encoding other than UTF-8
  is refused, since Python would read it as other code than what is shown.
  A file is shown as the code it holds, and each approval is bound to the code
  it showed: the file runs from a copy of what was read, only when that is the
  code its own approval showed, so a file changed after it was approved does
  not run. The copy runs as the file itself: its folder comes first on the
  import path, and `__file__` and the script's own name are the file's, so its
  neighbours import and a process pool finds it. A file outside the
  workspace, one over 1 MB, the size the tool's description states, or one
  that is not UTF-8 is refused before anyone is asked.

## Testing notes

The runner is replaceable, so argument building, environments and isolation
are tested against stand-ins for uv, pip and Python that leave on disk what
the real ones would. A real-engine test makes real environments when
`ZHIYIN_UV` points to `uv`, in a workspace holding a project whose dependency
does not exist; the isolation claim fails there if it is wrong. The same
tests run confined scripts against real files, shells and the hosts they name, a
`multiprocessing` pool and a program's output discarded; make an environment with each Python an environment may use and run Python's library confined in it; build a
package published only as source; and install a package whose own code tries
to read and write the person's files. Their default environment installs from
a lock of one package that the lock script writes, and a copy of that lock
whose hashes are wrong is refused. CI's gate installs `uv`, so there it runs.
