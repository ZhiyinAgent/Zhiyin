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
  tool reached through MCP needs a decision), guidance on when a workflow
  uses which git tool (the skills that call them), or the shell tool's
  availability. Both this connector and
  the shell tool rely on Git for Windows but detect it separately, so one's
  failure never hides the other's state.
- **Talks to other features only through:** the contract's
  `OfferedConnection`, which `gitConnection()` in the capabilities group adapts into a built-in MCP
  server. It imports no other feature, only the contract and the
  sandbox and workspace-containment mechanisms.

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
- `shellGit({ containment?, route?, resolveGit?, linksIn? })` answers the
  function that runs one git command for a sealed-off shell, outside its
  container (ADR 0029): given the command's arguments, its folder, the
  folders the shell may change, the hosts its conversation may reach, the
  conversation's home and its standard input as a file, it answers git's exit
  code, what it printed, each host the proxy refused it and whether any host
  sent it anything. `linksIn`, a `LinksIn` handed in by the composition root,
  names the links anywhere in a folder, `.git` and `node_modules` included,
  so a folder need not be walked whole for each command; absent, or when it
  cannot say, the folder is walked.
- `gitProgramLocations(root)` names, from the files alone, Git's records in
  a folder, each as a `GitLocation` with how a sealed-off program is held
  from it (ADR 0012).
- The types these take and return: `GitContainer`, `GitContainment`,
  `GitAutomationOptions`.

## Invariants

### git for a sealed-off shell (ADR 0029)

- It runs only in a folder the shell may change, and only on a repository
  whose top, git folder, common folder and alternates are all inside those
  folders. A path argument that leads elsewhere, and every global option but
  those that change nothing of where git works or what it runs, such as
  `-C`, `-c`, `--git-dir` and `--work-tree`, are refused before git starts.
- git runs with the person's own access, so nothing outside those folders
  reaches git through a junction or a symbolic link either: not into the
  repository's objects, nor into what git prints. A path argument, an
  option's value included, that leads out through one is refused before git
  starts, and so is every command in a repository, or outside one in a
  folder, that holds such a link anywhere, its git folder included, since
  git follows a junction as a folder. A link that stays inside the folders
  works. Each refusal says where the link leads and suggests full access.
  The folder is checked just before git starts, while the shell that asked
  is held still: every process of its container is suspended from before
  the check until git ends, however it ends, so none can make a link in
  between (the tools feature holds it, through the sandbox).
- It runs none of the programs a repository's settings or the person's could
  start. Every such setting is turned off for the command: hooks, the
  filesystem monitor, the pager and editors, the SSH command, askpass and
  proxy commands, external diff and textconv, signing programs, upload-pack
  and receive-pack, and, by name from the repository's own settings, each
  filter, diff and merge driver and each alias that runs a command; `diff`,
  `log`, `show` and `blame` are given `--no-ext-diff` and `--no-textconv`.
  The system settings are not read, and the person's are replaced by a file
  in the conversation's home holding only their name and email. `git init`
  copies nothing from a template folder, given one that is empty, and says
  nothing of templates.
- It uses no credential: no helper, no prompt. It reaches the network only
  over HTTPS, through Zhiyin's proxy on this computer's loopback, to the hosts
  the conversation may reach; with none, every protocol is refused.
- Commands that start programs or reach beyond the repository by design,
  such as `difftool`, `submodule`, `filter-branch`, `daemon` or `credential`,
  and options naming a program, such as `--upload-pack` or `--exec`, are
  refused.

### The connector

- Git's records in a folder are each git folder in it, held whole: its
  objects, refs, configuration and hooks, the top's and every repository's
  nested deeper, but not what installed packages keep in `node_modules`,
  where no one commits. One inside another is held with it. A submodule's or linked worktree's gitfile is held too, and the folders
  it sits in cannot be moved, so it cannot be swapped for another; a git
  folder a workspace's own gitfile names inside it is held whole. A folder
  that holds no repository has none, and a `.git` that is a link is not
  followed. The
  connector's own git runs are contained but not sealed off, so no hold
  reaches them.

- The tools that only read (`git_status`, `git_diff`, `git_log`, `git_show`
  and `git_branch`) are listed as reading, so a specialist that only reads is
  offered them; the tools that change the repository are not.
- With no folder selected, every operation refuses with "Choose a folder
  before using git."
- With no git found, `listTools` fails with a reason and every call is
  refused, so the connector shows as failed. It works as soon as git is
  installed.
- A ref, base or path that starts with `-` is refused, both when the call is
  inspected and when it runs, so it is never read as an option.
- Results are git's own output, whole, a change's followed by what holds
  after it: how much the model sees is decided
  where every tool's result is sized. A failure returns what git printed. A
  command Zhiyin ended, at its time limit, its
  output limit or a stop, says so first, rather than reading as git's error.
- A diff can be narrowed to some paths, compare with a base commit, branch
  or tag (every change since it, committed or not), or show only how many
  lines each file changed. The log can be narrowed to the commits that
  changed some paths, and a commit shown with its line counts or its changes
  to some paths. A diff of what is not staged names, after it, the new files
  git does not track yet, apart from those it ignores, which no diff shows;
  with nothing changed in tracked files, it says so.
- A git command may run for 30 seconds and print 64 MB, which every git
  tool's description states. One ended at either limit names it and asks
  for less, such as fewer commits or fewer paths.
- Every approval shows the call's inputs in words (its message, files, branch,
  commit or count), then the git command it runs, each argument as git
  receives it: one with a space, a quote or nothing in it is written in double
  quotes, and a message keeps its line breaks. What git answered is shown
  under those words, never under the tool's name.
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
- A call that changes the repository answers with what holds after it, read
  back as any read is: staging names the files whose staged content changed,
  from the index before and after, and shows what is staged now, and staging
  that changed nothing is an error; a commit gives git's answer, the branch
  and commit it is on and what is left uncommitted; a branch created gives
  git's answer, the commit it is at and the branch still checked out; a
  switch gives git's answer, the branch and commit it is on and what is left
  uncommitted, and is an error when the repository is not on the branch
  asked for; saving or restoring a stash gives how many stashes are kept and
  what is left uncommitted, and a save that kept no new stash is an error.
  What is left uncommitted counts staged, changed and untracked files, and
  each folder git does not track as a folder, with the files it holds; files
  that take more than 3 seconds to count are not counted, and it says so.
- A branch is created at the current commit without switching to it. A
  switch goes only to a local branch that exists, and is refused, at approval
  and again when it runs, while tracked files have uncommitted changes or
  while the work tree holds something of the person's where the branch
  would put a file, one git ignores included: a file, a folder of files git
  does not track, or a file or link where the branch has a folder. So
  nothing is carried over, lost, or written through a link. A branch name git
  would read as an option, would read as another branch (such as `@{-1}` or
  `@`), or does not allow, is refused, naming the branch input.
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
  not checked: they stay on. The filters and hooks to turn off are looked up
  once for each call and shared by its reads, and looked up again after a
  change, whose hooks can name new ones.
  Staging, committing, stashing and creating or switching a branch run as
  git runs them for the person,
  hooks and filters included, after approval. They are asked about every
  time, since those programs run with the account's full access, so no grant
  for the conversation covers them.
- Every call says what it does (ADR 0012). One that only reads reads the
  workspace and runs nothing; one that changes the repository runs its hooks
  and filters with the person's full access and changes the workspace with
  nothing backed up. Where the repository or the history git keeps for it
  lies beyond the folder, as for a folder inside a repository, a submodule or
  a linked work tree, the call reads, and a change changes, outside it.
- A call allowed for the conversation is allowed in the folder it was allowed
  in: once the conversation moves to another folder it is asked about again,
  and a call allowed in one folder does not run in another.
- In a repository with submodules, the status and the diff of unstaged or
  staged changes say that changes
  inside submodules' own files are not shown, from whichever of its folders
  the workspace is.
- Each git call runs through the sandbox platform, with a
  30-second limit.

## Testing notes

`resolveGit` is tested against a made-up environment. Everything after git is
found (staging, committing, stashing, diffing) runs against a real, disposable
repository in a temporary folder, because only git can confirm the argument
lists it accepts. Those tests are skipped on a machine without git.
