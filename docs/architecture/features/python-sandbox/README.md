# Python sandbox

## Purpose

Runs Python for one-off data work in an environment Zhiyin manages with `uv`,
kept apart from a person's own projects. It exists so exploratory analysis has
somewhere to run that cannot disturb a workspace project's dependencies, and so
installing a package is an explicit, visible act.

## Boundaries

- **Owns:** building and rebuilding the sandbox environment, running a script
  in it, adding packages to it, and keeping every `uv` command away from the
  workspace's own project files.
- **Does not own:** installing `uv` itself (toolchains), permission decisions,
  or connection lifecycle (MCP).
- **Talks to other features only through:** the connection shape the
  application registers with the MCP feature.

## Public interface

- `pythonSandbox({ workspaceRoot, directory, uv, containment?, run?, ... })`
  answers a `SandboxAutomation`: `listTools`, `callTool`, `inspect`,
  `describeResult`, `close`.
- Program execution uses the process-ownership platform mechanism; tests may
  replace that runner without redeclaring containment.
- Three tools: `run_python` (code or a workspace script, with arguments),
  `install_python_package`, and `reset_python_sandbox`.
- `defaultPackages` is what a fresh sandbox holds: pandas, polars, NumPy,
  SciPy, Matplotlib, seaborn, and statsmodels.

## Invariants

- **The sandbox is built once, from its own folder.** Every `uv` command runs
  with the sandbox as its working directory, so a `pyproject.toml` in the
  person's workspace can never decide what the sandbox contains. Named tests:
  `prepares the environment once, then runs the script in the workspace folder`
  and, against the real `uv`, `builds an environment apart from a project in
  the workspace, and runs a script in it`.
- **A script runs in the person's folder, through the sandbox's interpreter**,
  so it can read and write the work it is about while its dependencies stay the
  sandbox's. The same named tests guard this.
- **Code to run is never written into the person's folder**, and is removed
  after the run. Named test: `keeps the script it was given out of the person's
  folder, and removes it after`.
- **Only a `.py` file is run**, and a call that names no script at all is
  refused. Named test: `refuses anything but a .py file, and a call that names
  no script at all`.
- **A package is named by name and version, never by flags.** Anything else is
  refused before `uv` is called, so a call cannot redirect the index or smuggle
  options. Named test: `refuses a package name that is not one`.
- **Installing changes only the sandbox.** Named test: `installs into the
  sandbox, from the sandbox folder, never the workspace`.
- **Resetting rebuilds from nothing.** Named test: `rebuilds the sandbox from
  nothing when it is reset`.
- **A failure says what the run or the build reported.** Named tests: `reports a
  script that failed with its output rather than a bare code` and `says what
  went wrong when the environment cannot be built`.
- **Python reads and writes UTF-8**, whatever the console's code page, and
  otherwise runs in Zhiyin's own environment. Named test: `runs scripts with
  Python reading and writing UTF-8, in Zhiyin's own environment`.
- **No `uv`, no tools.** Named test: `offers no tool until uv is installed, and
  all of them once it is`.
- **A person is told what a call will do and where anything is downloaded
  from.** Named test: `tells a person what a call will do and where anything is
  downloaded from`.

## Testing notes

The invocation is replaceable, so argument construction and isolation are
tested without running `uv`. `real-uv.test.ts` builds a real environment when
`ZHIYIN_UV` names the binary, in a workspace holding a project whose dependency
does not exist — the isolation claim fails there if it is wrong.

## Open questions

- Preparing the sandbox downloads a Python and several large packages, so the
  first call is slow. It reports what it did, but there is no progress while it
  runs.
- Running arbitrary Python is as powerful as the shell tool; it is bounded by
  the same permission engine, not by a sandbox in the operating-system sense.
