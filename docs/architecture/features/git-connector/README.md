# Git connector

## Purpose

Local git as typed tools, one per operation: `git_status`, `git_diff`,
`git_log`, `git_show`, `git_branch`, `git_stage`, `git_commit`, `git_stash`,
`git_create_branch` and `git_switch_branch`. Because each operation is its own
tool, its approval can say exactly what it will do, where a shell approval
shows only a command line.

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
- **Talks to other features only through:** the contract's
  `OfferedConnection`, which `gitConnection()` in the capabilities group adapts into a built-in MCP
  server. It imports no other feature, only the contract and the
  process-ownership mechanism.

## Public interface

- `resolveGit(environment?)` returns the path of `git.exe`, or `undefined`. It
  checks `ZHIYIN_GIT`, then the usual Git for Windows install folders, then
  `PATH`. Nothing is cached, so a new install is found the next time anything
  asks.
- `gitAutomation({ workspaceRoot, containment?, resolveGit? })` returns an
  `OfferedConnection`: `listTools`, `callTool`, `inspect`, `describeResult`
  and `close`.
- `gitInstallUrl`, where Git for Windows is downloaded, offered when Git is
  missing.
- The types these take and return: `GitContainer`, `GitContainment`,
  `GitAutomationOptions`.

## Invariants

- The tools that only read (`git_status`, `git_diff`, `git_log`, `git_show`
  and `git_branch`) are listed as reading, so a specialist that only reads is
  offered them; the tools that change the repository are not.
- With no folder selected, every operation refuses with "Choose a folder
  before using git."
- With no git found, `listTools` fails with a reason and every call is
  refused, so the connector shows as failed. It works as soon as git is
  installed.
- A ref or path that starts with `-` is refused, both when the call is
  inspected and when it runs, so it is never read as an option.
- Results are git's own output, shortened past 4,000 characters. A failure
  returns what git printed. A command Zhiyin ended, at its time limit, its
  output limit or a stop, says so first, rather than reading as git's error.
- The `git_commit` approval shows the message and `git diff --staged --stat`,
  run when the call is inspected, or says that nothing is staged. Whatever is
  staged, nothing included, since git runs them before it refuses an empty
  commit, it names the hooks a commit runs, from the folder git looks in for hooks, which follows
  `core.hooksPath`, with or without `.exe`, and from the settings, and says
  they can change what is committed. Where they cannot be told, as for a hooks
  folder on another computer, which is not looked at before approval, it says
  any hooks do.
- Staging counts the paths it is given, never files: a folder or pattern adds
  every file under it, apart from new files git ignores, and the approval says
  so.
  Saving a stash says it sets aside the tracked changes of the whole
  repository, naming its folder, and leaves new files; restoring one, and
  switching a branch, say they change the whole repository's tracked files
  and name its folder, from a folder inside it too.
- A branch is created at the current commit without switching to it. A
  switch goes only to a local branch that exists, and is refused, at approval
  and again when it runs, while tracked files have uncommitted changes or
  while the work tree holds something of the person's where the branch
  would put a file, one git ignores included: a file, a folder of files git
  does not track, or a file or link where the branch has a folder. So
  nothing is carried over, lost, or written through a link. A branch name git
  would read as an option, would read as another branch (such as `@{-1}` or
  `@`), or does not allow, is refused and named for a repair.
- A connection works on the repository in the folder it is given, read on
  every call. No git operation keeps state between calls, so one connection
  can be opened for each conversation.
- Git never waits for someone to type a login. Terminal prompts and Git
  Credential Manager's windows are turned off, so a remote that asks for
  credentials fails at once. Git's editor and pager are turned off too.
- Git acts on the workspace's repository, whatever environment Zhiyin
  inherited. The variables that tie git to a particular repository, index or
  work tree (`GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE` and the others
  `git rev-parse --local-env-vars` lists) are removed; variables that only
  configure git are kept.
- Git runs only on the repository the folder holds. Where the repository's
  own files send git elsewhere, every call is refused before anything runs,
  saying where git would act: `core.worktree` naming another folder; a
  `.git` file, a `.git` link or a `commondir` naming another repository's
  history, a bare one included; a history with a link among its entries, or
  anywhere in its objects or references, or whose `alternates` borrow objects
  from outside the repository; and a repository reached over the network from
  a folder on this computer. Where git cannot say which repository the folder
  holds, nothing runs either, and git's answer says why. A submodule's
  folder, a linked work tree, a submodule of one and a folder inside a
  repository work; a history kept apart from its work tree, as
  `git init --separate-git-dir` makes, is refused.
- A call that only reads (status, diffs, log, show, branches, the stash list,
  and the look at what is staged before a commit) starts no program the
  repository brings: no hook, in its hooks folder or defined in its
  settings, no file monitor, outside diff tool, diff converter, filter its
  own settings define, whatever its name, or signature checker, no fetch, of
  what a partial clone is missing or anything else, over any transport, even
  one the repository allows itself, and nothing from a submodule's own
  settings, whose work tree a read does not look inside. A folder can arrive
  with its `.git` from anywhere. The person's own filters, as Git LFS is,
  and hooks they define in their own settings still apply, so a file stored
  through one reads as unchanged. Reading needs Git 2.31 or newer, the first
  to take the settings that do this; an older git is refused before it reads.
  A repository whose settings cannot be read whole is not read, nor one that
  names a filter or hook of its own in bytes that are not UTF-8, which no
  setting Zhiyin gives can name. How the person's own settings name theirs is
  not checked: they stay on.
  Staging, committing, stashing and creating or switching a branch run as
  git runs them for the person,
  hooks and filters included, after approval. They are asked about every
  time, since those programs run with the account's full access, so no grant
  for the conversation covers them. A refused reference or list of paths is
  named for a repair to aim again; git's refusal never names a commit
  message. The schema check does when the message is missing or not text, and
  a commit is asked for every time.
- A call allowed for the conversation is allowed in the folder it was allowed
  in: once the conversation moves to another folder it is asked about again,
  and a call allowed in one folder does not run in another.
- In a repository with submodules, the status and the diff of unstaged or
  staged changes say that changes
  inside submodules' own files are not shown, from whichever of its folders
  the workspace is.
- Each git call runs through the process-ownership mechanism, with a
  30-second limit.

## Testing notes

`resolveGit` is tested against a made-up environment. Everything after git is
found (staging, committing, stashing, diffing) runs against a real, disposable
repository in a temporary folder, because only git can confirm the argument
lists it accepts. Those tests are skipped on a machine without git.
