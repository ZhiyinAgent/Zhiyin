# Git connector

## Purpose

Local git as typed, per-operation tools — `git_status`, `git_diff`, `git_log`,
`git_show`, `git_branch`, `git_stage`, `git_commit`, `git_stash` — rather than
routed through the generic shell tool. A `git_commit` approval can then show
the real staged diff and the real message; a bash approval showing
`git commit -m "..."` cannot show anything beyond the command string itself.

Shells to the system `git` binary, the same way the shell tool shells to
`bash` — no new process-spawning mechanism, no in-process reimplementation of
git's object model. Considered and rejected `isomorphic-git`: it needs no
prerequisite, but a pure-JS reimplementation of git's object and packfile
format is real audit surface in a codebase meant to be "auditable by technical
ones" (AGENTS.md), for a capability that only matters once a person already
has a repository open — at which point git having touched the machine at some
point is a reasonable bet, the same bet the shell tool already makes for
`bash.exe`.

## Boundaries

- **Owns:** detecting `git.exe`, building and running each operation's argv
  (never a shell string — no quoting risk), and each operation's own
  permission description.
- **Does not own:** whether a git call is permitted (permission engine, which
  treats every MCP-routed tool — built-in or not — as needing an explicit
  decision; see `GuardedPermissionEngine`), git workflow guidance (a separate,
  independent skill), or the shell tool's own availability (`@zhiyin/tools`'s
  `shellAvailability`) — the two features share the Git-for-Windows
  prerequisite but keep independent detection code paths on purpose, so one's
  failure never silently hides the other's state.
- **Talks to other features only through:** `GitAutomation`, adapted into a
  `BuiltInMcpServer` by `gitConnection()` in the capabilities group — this
  feature imports no peer feature. It shares only contract vocabulary and the
  process-ownership platform mechanism.

## Public interface

- `resolveGit(environment?)` — the resolved `git.exe` path, or `undefined`.
  Cheap (a handful of `accessSync` checks) and never cached, so an install is
  picked up the next time anything asks.
- `gitAutomation(options)` — `{ workspaceRoot, containment?, resolveGit? }` →
  a `GitAutomation`: `listTools`, `callTool`, `inspect`, `describeResult`,
  `close`.
- Git execution uses the process-ownership platform mechanism rather than a
  connector-local spawn path.
- `GitAutomation`/`GitConnectionTool` — the shapes `gitConnection()` (in
  `@zhiyin/capabilities`) adapts into a `BuiltInMcpServer`.

## Invariants

- **No folder, no git.** Every operation refuses with "Choose a folder before
  using git." when no workspace folder is selected, the same refusal shape
  `WorkspaceTools` uses for its own folder-scoped tools. Named test: `refuses
  to inspect or run a tool` (no workspace folder).
- **No git, no operation — with a reason, live-checked.** `listTools()`
  re-detects git on every call rather than caching a past failure; a missing
  git surfaces as the built-in's own `failed` status through the existing
  connector-unavailable path, not a bespoke UI. Named test: `refuses to list
  tools, inspect, or run one` (git not found). The `#openBuiltIns()` guard
  that makes this retry on every `manage()` call, rather than sticking
  forever, is `@zhiyin/mcp`'s own invariant — see that feature's README.
- **A ref, path, or similar caller-supplied argument is never read as a
  flag.** Any such argument starting with `-` is refused outright rather than
  passed to git, where it could be misread as an option instead of the value
  it is supposed to be. Both permission inspection and execution enforce the
  rule. Named tests: `shows a commit's diff and refuses a flag in every ref
  path` and `refuses a flag in every staging path`.
- **Branch results come from the repository.** `git_branch` reports git's
  current-branch marker after a commit rather than returning a connector-local
  success placeholder. Named test: `reports the current branch after a
  commit`.
- **`git_commit`'s permission preview shows the real staged diff.** Its
  `inspect()` runs `git diff --staged --stat` itself and puts the summary in
  `detail` — an established consequence, not a claim — rather than only
  showing the command string. Named test: `stages, commits, and reads back
  what it committed`.
- **One shared connection, not one per conversation.** Unlike the browser,
  nothing about a git operation is conversation-scoped state, so `open()`
  always returns the same automation and there is no `forget`. Named test:
  `shares one connection across every conversation, unlike the browser`.

## Testing notes

Detection (`resolveGit`) is tested against a fabricated environment, the same
way `@zhiyin/tools`'s `resolveShell` is. Everything downstream of "git is
found" (staging, committing, stashing, diffing) is tested against a real,
disposable git repository in a temp directory — a fake would only prove this
feature's own bookkeeping, not that the argv it builds is what git actually
accepts. Gated by `resolveGit()` the same way `run-command.test.ts` gates its
real-shell tests, so the suite still passes on a machine without git.
