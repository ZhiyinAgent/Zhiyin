# Python environment

## Purpose

Runs Python for data work in an environment Zhiyin manages with `uv`, kept
apart from the person's own projects. Analysis gets somewhere to run that
cannot disturb a workspace project's dependencies, and installing a package is
an explicit, visible step. People see it as the Python environment.

The environment keeps dependencies apart; it does not limit what a script can
reach. A script runs with the person's own access to files and the network,
and every call needs the person's approval.

## Boundaries

- **Owns:** building and rebuilding the environment, running a script in it,
  adding packages to it, and keeping every `uv` command away from the
  workspace's own project files.
- **Does not own:** installing `uv` (toolchains), permission decisions, or the
  connection's lifecycle (MCP).
- **Talks to other features only through:** `SandboxAutomation`, which
  `pythonConnection()` in the capabilities group adapts into a built-in
  connection the MCP feature serves.

## Public interface

- `pythonSandbox({ workspaceRoot, directory, uv, containment?, run?, ... })`
  returns a `SandboxAutomation`: `listTools`, `callTool`, `inspect`,
  `describeResult` and `close`.
- Three tools: `run_python` (code, or the workspace-relative path of a `.py`
  file, with arguments), `install_python_package`, and
  `reset_python_environment`.
- `defaultPackages` is what a fresh environment holds: pandas, polars, NumPy,
  SciPy, Matplotlib, seaborn and statsmodels. The default Python is 3.13.
- Programs run through the process-ownership mechanism (ADR 0004). A script
  may run for five minutes, and building the environment for fifteen. Tests
  may replace the runner.

## Invariants

- The environment is built once, on first use, in its own folder in the app's
  data. Every `uv` command runs with that folder as its working directory, so
  a `pyproject.toml` in the workspace never decides what the environment
  contains.
- A script runs with the workspace as its working directory, through the
  environment's interpreter, so it works on the person's files with the
  environment's packages.
- Code passed as text is written to the environment's own folder, never the
  workspace, and removed after the run.
- Only a `.py` file is run, and a call that gives neither code nor a file is
  refused.
- A package is named by name, optional extras and version only. Anything else
  is refused before `uv` runs, so a call cannot change the package index or
  pass options.
- Installing changes only the environment. Resetting deletes it and builds it
  again, and its approval says that added packages will be removed.
- A failure reports what the run or the build printed, with the exit code. The
  whole output is passed on, so a traceback at the end survives; how much of
  it the model sees is decided where every tool's answer is sized.
- Python reads and writes UTF-8 whatever the console's code page, and
  otherwise inherits Zhiyin's environment variables.
- With no `uv` installed the connector offers no tool, and it offers all three
  as soon as `uv` is installed.
- The approval says what a call will do and where anything is downloaded
  from: Python and the default packages when the environment is first built,
  and added packages from pypi.org.

## Testing notes

The runner is replaceable, so argument building and isolation are tested
without `uv`. A system-boundary test builds a real environment when
`ZHIYIN_UV` points to `uv`, in a workspace holding a project whose dependency
does not exist; the isolation claim fails there if it is wrong.
