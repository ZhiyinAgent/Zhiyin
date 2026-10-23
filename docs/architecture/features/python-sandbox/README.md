# Python environment

## Purpose

Runs Python for data work in environments Zhiyin manages, kept apart from the
person's own projects. Analysis gets somewhere to run that cannot disturb a
workspace project's dependencies, and installing a package is an explicit,
visible step. People see it as the Python environment.

A `default` environment holds the usual data stack. The model can make others,
each with its own Python version and packages, for work that needs another
Python or packages that would clash with the default's. Environments are kept
between conversations, and every conversation can use each of them.

A script runs confined (ADR 0006): it reads and changes only the workspace,
and uses the internet only when its call asks for it. Installing a package
runs confined too (ADR 0026): what the package's own code does while it
installs reaches only its environment.

## Boundaries

- **Owns:** making, rebuilding and removing environments, running a script in
  one, adding packages to one, and keeping every `uv` command away from the
  workspace's own project files.
- **Does not own:** installing `uv` (toolchains), permission decisions, or the
  connection's lifecycle (MCP).
- **Talks to other features only through:** the contract's
  `OfferedConnection`, which `pythonConnection()` in the capabilities group adapts into a built-in
  connection the MCP feature serves.

## Public interface

- `pythonSandbox({ workspaceRoot, directory, uv, containment?, run?, lock?, ... })`
  returns an `OfferedConnection`: `listTools`, `callTool`, `inspect`,
  `describeResult` and `close`.
- `pythonSandboxes({ directory, uv, ... })` returns a function that makes a
  connection from a folder getter, `(workspaceRoot) => OfferedConnection`,
  read on every call. Each runs scripts in the folder it reads, and all share the one set of
  environments: two folders' first runs make the default environment once.
- Six tools:
  - `run_python`: code, or the workspace-relative path of a `.py` file, with
    arguments, `network` to let it use the internet, and `environment`.
  - `install_python_package`: packages, and `environment`.
  - `create_python_environment`: a name, a Python version, and packages.
  - `list_python_environments`.
  - `remove_python_environment`: a name.
  - `reset_python_environment`: `environment`.

  A call that names no environment uses `default`.
- `defaultPackages` is what the default environment asks for: pandas, polars,
  NumPy, SciPy, Matplotlib, seaborn, statsmodels, and openpyxl for Excel
  workbooks. `defaultLock`, a `PackageLock`, pins those and what they need to
  one version each, as published by `defaultPackagesPublishedBy`, with the
  SHA-256 of every file of each version (ADR 0026). It names the Python too,
  3.13, which is also that of an environment made without naming one. A
  script beside the package writes the lock with uv, run by hand with a
  release when the date moves. The `lock` option replaces it, for tests.
- Programs run through the process-ownership mechanism (ADR 0005). A script
  may run for five minutes; making an environment or installing into one, for
  fifteen. Scripts and installs run only confined, so without containment
  they do not run. Tests may replace the runner.
- The types these take and return: `ProgramContainer`, `ProgramContainment`,
  `ProgramRun`, `RunProgram`, `PythonSandboxOptions`, `PackageLock`.

## Invariants

Environments:

- The default environment is made on first use, by a script or an install
  that names it. Making it deletes the single environment kept before
  environments had names.
- An environment is named by up to 32 lowercase letters, digits and dashes,
  starting with a letter, and never by a name Windows keeps for a device. Its
  Python is named by a 3.x version. `default` cannot be created or removed;
  resetting rebuilds it. A call that names an environment any other way, a
  path included, finds none, even where one would be found at that path, and
  nothing runs.
- An environment is either whole or gone: when making it or installing its
  first packages fails, what was made is deleted and the call says why.
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
  may use the internet. Whatever the package's own code does as it installs,
  Windows refuses it every other file the person keeps.
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
  limits. It reaches the internet only when its call asks for it, and a call
  that answers with anything but true or false is refused before anything
  runs.
- **No script can change another's code before it runs.** Code passed as text
  waits in a folder of the sandbox's that scripts may read and not change,
  never the workspace, and is removed after the run.
- **Scripts with and without the internet keep homes apart.** Each has a home
  in the sandbox's folder for each workspace, kept between runs, so what one
  without the internet leaves there is never read by one that could send it
  on, and nothing one workspace's scripts leave reaches another's.
- **Python's own library works confined**: a `multiprocessing` pool runs, the
  temporary folders Python makes are usable, and pip unpacks and builds a
  package published only as source. A container may not open `NUL`, so what a
  script writes to `os.devnull` or a program's `DEVNULL` output is read and
  dropped through a pipe, kept nowhere, and reading either ends at once. A
  shell's own `> nul` still fails there.
- Only a `.py` file is run, and a call that gives neither code nor a file is
  refused.

What is said:

- A failure reports what the run, the build or the install printed, with the
  exit code. The whole output is passed on, so a traceback at the end
  survives; how much of it the model sees is decided where every tool's answer
  is sized. Python's warning, on every start in a container, that it cannot
  find where its own program lies is left out.
- Python reads and writes UTF-8 whatever the console's code page. Python, pip
  and `uv` are given only the variables every confined program is: those
  Windows programs expect and those that say how to reach the network
  (proxies and certificates), so no
  variable points them at another environment, package index or startup
  script, and no credential kept in a variable reaches a script, apart from
  one written into a proxy's address.
- With no `uv` installed the connector offers no tool, and it offers all six
  as soon as `uv` is installed.
- The approval says what a call will do and names where it is sent:
  pypi.org for an install, and releases.astral.sh too, where uv downloads
  Python, when an environment is made or reset. A script is sent nowhere;
  when it is the first to use the default environment, its approval says that
  the environment is made first, and where from. Installing says that a
  package's own code can change only its environment and use the internet. Running a script names its environment unless it is
  the default, and says that it reads and changes only the workspace, and
  whether it can use the internet. Rebuilding the default environment says
  that its packages are the versions Zhiyin pins, each checked against the
  SHA-256 Zhiyin keeps.
- Scripts without the internet, in any environment, are one set the person
  can allow for the conversation; one with it is asked for each time, and so
  is every change to an environment. Listing can be allowed for the
  conversation.
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
  workspace, one over 1 MB or one that is not UTF-8 is refused before anyone
  is asked.

## Testing notes

The runner is replaceable, so argument building, environments and isolation
are tested against stand-ins for uv, pip and Python that leave on disk what
the real ones would. A real-engine test makes real environments when
`ZHIYIN_UV` points to `uv`, in a workspace holding a project whose dependency
does not exist; the isolation claim fails there if it is wrong. The same
tests run confined scripts against real files, shells and the internet, a
`multiprocessing` pool and a program's output discarded; make an environment with another Python; build a
package published only as source; and install a package whose own code tries
to read and write the person's files. Their default environment installs from
a lock of one package that the lock script writes, and a copy of that lock
whose hashes are wrong is refused. CI's gate installs `uv`, so there it runs.
