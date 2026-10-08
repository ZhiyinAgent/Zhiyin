# Git connector

## Purpose

Local git as typed tools, one per operation: `git_status`, `git_diff`,
`git_log`, `git_show`, `git_branch`, `git_stage`, `git_commit` and
`git_stash`. Because each operation is its own tool, its approval can say
exactly what it will do, where a shell approval shows only a command line.

The connector runs the system's `git.exe` with an argument list, the same way
the shell tool runs `bash.exe` from Git for Windows. It does not bundle its own
implementation of git, so what runs is the git the person already has, and
there is no second implementation of git's storage format to audit.

## Boundaries

- **Owns:** finding `git.exe`, building and running each operation's argument
  list (never a shell string, so there is no quoting to get wrong), and each
  operation's approval description.
- **Does not own:** whether a git call is allowed (permission engine; every
  tool reached through MCP needs a decision), git workflow guidance (a
  separate skill), or the shell tool's availability. Both this connector and
  the shell tool rely on Git for Windows but detect it separately, so one's
  failure never hides the other's state.
- **Talks to other features only through:** `GitAutomation`, which
  `gitConnection()` in the capabilities group adapts into a built-in MCP
  server. It imports no other feature, only the contract and the
  process-ownership mechanism.

## Public interface

- `resolveGit(environment?)` returns the path of `git.exe`, or `undefined`. It
  checks `ZHIYIN_GIT`, then the usual Git for Windows install folders, then
  `PATH`. Nothing is cached, so a new install is found the next time anything
  asks.
- `gitAutomation({ workspaceRoot, containment?, resolveGit? })` returns a
  `GitAutomation`: `listTools`, `callTool`, `inspect`, `describeResult` and
  `close`.
- `GitAutomation` and `GitConnectionTool` are the shapes `gitConnection()`
  adapts.

## Invariants

- With no folder selected, every operation refuses with "Choose a folder
  before using git."
- With no git found, `listTools` fails with a reason and every call is
  refused, so the connector shows as failed. It works as soon as git is
  installed.
- A ref or path that starts with `-` is refused, both when the call is
  inspected and when it runs, so it is never read as an option.
- Results are git's own output, shortened past 4,000 characters. A failure
  returns what git printed.
- The `git_commit` approval shows the message and `git diff --staged --stat`,
  run when the call is inspected, or says that nothing is staged.
- All conversations share one connection, since no git operation keeps state
  between calls.
- Git never waits for someone to type a login. Terminal prompts and Git
  Credential Manager's windows are turned off, so a remote that asks for
  credentials fails at once. Git's editor and pager are turned off too.
- Git acts on the workspace's repository, whatever environment Zhiyin
  inherited. The variables that tie git to a particular repository, index or
  work tree (`GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE` and the others
  `git rev-parse --local-env-vars` lists) are removed; variables that only
  configure git are kept.
- Each git call runs through the process-ownership mechanism, with a
  30-second limit.

## Testing notes

`resolveGit` is tested against a made-up environment. Everything after git is
found (staging, committing, stashing, diffing) runs against a real, disposable
repository in a temporary folder, because only git can confirm the argument
lists it accepts. Those tests are skipped on a machine without git.
