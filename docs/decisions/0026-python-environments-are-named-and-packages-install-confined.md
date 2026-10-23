# 0026. Python environments are named, packages install confined, and the defaults come from a hashed lock

Status: accepted

## Decision

- **Zhiyin keeps named Python environments.** A `default` environment holds
  the data stack and is made on first use. The model makes others, each with
  the Python version and packages it asks for, and can add to, reset, list and
  remove them through the Python environment's own tools; there is no settings
  page. Every conversation uses the same environments, and they are kept until
  removed.
- **uv makes environments and nothing else runs it.** It downloads Python into
  Zhiyin's own folder and makes each environment with pip in it. It runs
  without a container, because it cannot run in one.
- **The default packages install from a lock Zhiyin keeps.** It pins each
  package the default environment asks for, and each one those need, to one
  version, with the SHA-256 of every file of that version. uv installs it into
  a new default environment with `--require-hashes --no-build`: wheels only, so
  none of their own code runs, and a file whose hash the lock does not list is
  refused, so the install fails and leaves no default environment.
- **The lock is chosen by a date and a platform.** Its versions are those
  published by a date fixed with each release, resolved for the lock's Python
  minor version on Windows x64. The lock names that Python, and the default
  environment is made with it. A script beside the package writes the lock,
  with the uv Zhiyin pins, and is run by hand with a release when the date
  moves. It refuses anything uv prints that is not a pinned, hashed package.
  The lock is reviewed like code.
- **Every environment's pip is the one published by the same date:** `uv venv
  --seed` runs with `--exclude-newer`. pip itself is not hashed.
- **A package the model asks for is installed by the environment's own pip in
  an app container** (ADR 0006). pip reads Zhiyin's Python, changes only that
  environment, and may use the internet. Each environment's installs keep a
  home of their own.
- **How each environment was made is kept beside it, where pip cannot write.**
  Resetting rebuilds the environment from that record: the Python and the
  packages it was made with.
- **What a container breaks in Python is mended in each environment.** A
  module loaded by a path file in the environment's packages makes the folders
  Python makes private reachable, names `multiprocessing`'s pipes where a
  container may, and finds a file's final path through its device name when
  Windows refuses it by its drive.
- **Approvals:** scripts without the internet, in any environment, are allowed
  once in a conversation; a script with it, and every change to an
  environment (making, installing, resetting, removing), is asked for each
  time (ADR 0009). Listing can be allowed for the conversation.

## Why

One environment cannot hold packages whose versions clash, nor a second
Python. Installing a package with uv runs its own build code, such as a source
package's `setup.py`, with the person's whole access, because uv cannot run in
a container. pip can, so a package's install code reaches only the
environment it installs into.

A date cap alone fixes the versions on pypi.org: uv compares the date with
each file's upload time, and PyPI never reuses a file name. What it leaves is
an index or a proxy in between that serves other bytes, which uv would install
unchecked, and a release yanked or deleted since the date, which changes what
resolves. Every toolchain Zhiyin downloads is pinned by version and SHA-256;
the lock holds the default packages to the same. A pip seeded without the cap
would be whichever is newest.

The costs: each environment takes its own disk space; an install runs at
pip's speed rather than uv's; a record kept apart from the folder can disagree
with it when something else changes the folder; a lock of 26 packages and 785
hashes in the repository; a script to run with each release; and no default
environment when a locked file is withdrawn from the index, until the lock is
regenerated.

## Rejected

- uv for every install: it cannot run in a container, so a package's build
  code would run with the person's access.
- uv with `--no-build` for the model's packages: safe, and refuses every
  package published only as source.
- Resolving the default packages by name at install time, capped by date: it
  leaves them unchecked against an index or proxy that serves other bytes.
- Keeping only the hash of the wheel each package installs on Windows:
  smaller, but the script would have to map hashes to files through the index,
  and uv prints no such map.
- Shipping the wheels with the installer: the installer would carry the whole
  data stack for an environment many people never make.
- Installing pip from the lock as well: pip installs only what the model asks
  for, in a container that changes only its environment, so the date cap is
  enough there.
- One environment per conversation: each conversation would download and
  install the data stack again.
- A settings page for environments: the model's tools cover what is needed.
- Loading the startup module as `sitecustomize`: pip builds a source package
  with a `sitecustomize` of its own, which hides it.
- Keeping the record inside the environment: a package's install code could
  change what a reset rebuilds.

## Assumptions

Measured on Windows 11 (22631) with uv 0.12.15: on 2026-10-17 with pip 26.2.1
and Python 3.12 and 3.13 as uv downloads them, and on 2026-10-19 where marked.

- uv cannot run in a container: it fails resolving a path whose final name
  Windows refuses it.
- In a container, a file's final path named by its drive or its volume is
  refused, and named by its device is given. `os.path.realpath`, and with it
  `tarfile` and so pip's unpacking of a source package, then fails, unless
  mended.
- pip installs wheels and builds a source package in a container once that is
  mended. The environment it builds in adds the environment's packages folder
  through `site`, so the path file loads the mending module there too.
- A drive's device is what the drive-named and device-named paths of a folder
  differ by, wherever no link lies between them. Where one does, the mend
  gives up and the refusal stands.
- A build that needs a compiler or other tools outside Windows' own folders is
  not measured.
- `uv pip install --require-hashes` refuses a file whose SHA-256 the
  requirements do not list, including one already in uv's cache, a requirement
  not pinned with `==`, and a dependency the requirements do not list
  (2026-10-19).
- `uv pip compile --python-platform x86_64-pc-windows-msvc --python-version
  3.13` prints no environment markers, so the lock is complete for the Python
  3.13 patch release uv downloads: wheels are tagged by minor version
  (2026-10-19).
- `uv venv --seed --exclude-newer` seeds the pip published by that date
  (2026-10-19).
- PyPI keeps the files of a published version available; one withdrawn makes
  the default environment fail to install rather than install something else
  (2026-10-19).
