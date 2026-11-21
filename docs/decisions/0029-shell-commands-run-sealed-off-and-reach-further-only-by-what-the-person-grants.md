# 0029. Shell commands run sealed off, and reach further only by what the person grants

Status: accepted. It supersedes ADR 0012's section on the shell and its
rejection of a shell sealed off in an app container, and adds the shell to the
purposes of ADR 0006. Its backups are those of ADR 0031.

## Decision

### The shell runs sealed off

- **Every command runs in an app container** (ADR 0006), one command per
  action, starting in the workspace folder, inside its Job Object (ADR 0005).
- **The shell is busybox-w32**, built by Zhiyin from a pinned commit with
  Zhiyin's patch for the null device (below), and pinned like every program
  Zhiyin downloads (ADR 0027). Its `sh` is a POSIX shell with some of bash's
  extensions and no arrays; its Unix tools (`grep`, `sed`, `awk`, `find`,
  `tr`, `xargs` and the rest) are its own, so no Unix runtime is loaded. The
  shell's description tells the model what it is and that bash-only syntax
  fails. busybox-w32 is GPL-2.0: its exact source, Zhiyin's patches and the
  build's pins ship inside the installer with it.
- **Node is Zhiyin's own**, pinned like Python and uv (ADR 0027), installed on
  first use and first on the sealed shell's path: a container cannot run the
  Node its installer puts in `Program Files`, which grants nothing to app
  containers.
- **The null device is the shell's own.** A container cannot open Windows'
  `NUL`, so the shell answers `/dev/null` itself: writes are discarded and
  reads end at once, for the shell and for the programs it starts with a
  redirect to it. A program that opens `NUL` itself still fails in the
  container; the model is told so, and runs it with full access.
- **git runs through Zhiyin.** git opens the null device whenever it starts,
  so it cannot run in a container. The container's `git` hands its arguments,
  folder and streams to Zhiyin through a pipe only that container can open,
  and Zhiyin runs the git its Git connection uses, outside the container:
  - in the conversation's folder or a folder granted to it, never elsewhere;
  - with every setting that runs a program turned off: hooks, filters,
    textconv and external diff and merge drivers, the fsmonitor, the pager and
    editors, aliases that run commands, credential helpers, ssh commands,
    signing programs, and included configuration files;
  - reaching only the hosts on the conversation's list, over HTTPS through
    Zhiyin's proxy, and never with the person's credentials;
  - refused before it starts when a path it is given, or anything in the
    repository, leads through a junction or symbolic link outside those
    folders, since git, outside the container, would follow it;
  - with every process of the conversation's container suspended while it
    runs, so nothing the container starts can change what git finds.

  What it changes is saved as any writer's is (ADR 0031). A push with the
  person's credentials, or over ssh, is a command with full access.
- **What a command is given:**
  - it reads the workspace, Zhiyin's toolchains, what Windows keeps open to
    every app container, and the folders granted to the conversation for
    reading;
  - it changes the workspace and the folders granted to the conversation for
    changing;
  - it keeps a home of its own for the conversation, where its tools' caches
    and settings go (npm, pip, cargo), named by the variables those tools read;
  - it reaches the hosts on the conversation's list, through Zhiyin's proxy,
    and no other address.
- **A command reaches its own container's loopback and never this
  computer's.** A server it starts and a test that calls that server meet
  inside the container. Zhiyin's own servers, and every other program
  listening on this computer, stay out of reach.
- **A server the person needs to open is carried out on request.** The model
  asks for a port of its container to be shown; Zhiyin listens on a port of
  this computer's loopback and carries each connection through a pipe to the
  container, for as long as the conversation's command runs. Only that port
  is carried, and only inward.
- **What runs later stays out of reach, as for scripts** (ADR 0012): each
  `.git` folder and every Startup folder the command could reach is held
  read-only for the run. git through Zhiyin writes `.git` as git does.
- **Its changes are saved as every writer's are** (ADR 0031): the workspace
  and each folder granted for changing are watched from the turn's start, and
  every file a command creates, changes or deletes is undone by going back.

### Deciding a command

- **A sealed-off command declares what its container allows**, nothing more:
  it reads the workspace and the folders granted for reading, changes the
  workspace and the folders granted for changing, runs code sealed off, and
  sends to the hosts on the list. It is decided by those effects (ADR 0012),
  never by its text. A command that changes nothing beyond what is backed up
  and reaches no host the person has not allowed runs without a card.
- **A command that received anything from a host brings outside content** into
  the conversation. The proxy counts what each host sent.
- **A command with the person's full access remains**, asked every time, with
  the card it has today, run by the same shell outside the container, in the
  person's own environment, so the model writes one kind of shell; its git
  is whichever the person's path finds. The model uses it for what a
  container cannot do:
  installing for the whole computer, pushing with the person's credentials,
  a tool installed only in the person's profile, a program that opens the
  null device itself. The tool says which of the two a call is; its code, not
  the model's sentence, declares the effects.
- **The model knows its container.** The shell's description says what a
  command reaches, how to ask for more, and that a refusal is the container's.
  A host the proxy refused is told to the model by name, with the next answer.
  A file Windows refused is not reported to Zhiyin; an access error on a path
  outside what the command was given is answered with a note naming the way to
  ask.
- **Repeated refusals stop the turn.** When the person declines three requests
  in a row, the turn ends and says why.

### Asking for more

- **The model asks with `request_access`**, naming a host or a folder and why.
  The card is built from fields Zhiyin checks itself: the registrable domain or
  exact host, the folder's whole real path, and reading or changing. The
  model's reason is shown as its claim, in the same words as everywhere else.
- **A grant lasts for the conversation**, is shown in the conversation's
  permissions, can be taken back there, and does not carry to another
  conversation or to another folder the conversation moves to.
- **A grant holds only for what the person was told.** Each grant records the
  conversation's two facts (ADR 0012) as the card stated them. When the
  conversation gains a fact the card did not cover, the next command that
  could reach a grant shows one card naming every grant it affects, and runs
  once they are confirmed. A grant the person does not confirm is taken back.

### Hosts

- **A host grant names a website**: its registrable domain by the Public
  Suffix List, which covers every name below it, or one exact host. A
  registrable domain under a suffix where anyone can have a name, such as
  `alice.github.io`, is its own website, apart from `bob.github.io`. Port 443
  unless another is named. A public suffix, an address of this computer or its
  network, and a host shared too widely to name a website, such as a cloud
  provider's storage or CDN domain, are refused before a card.
- **The card says what the grant lets out.** The proxy sees which host a
  connection goes to, never what it sends. Where something private is within
  reach, the card says that what the conversation can read could be sent to
  anyone who uses that website. Where nothing private is within reach, it says
  that commands may download from it.
- **Package registries are built in**: npm's, PyPI's and crates.io's, with the
  hosts that keep their files, and the Git hosting sites Zhiyin lists. They are
  on every conversation's list without a card while outside content and
  something private have not met, and are confirmed like any grant once they
  do, since a registry or a Git host also takes uploads.
- **A redirect does not widen the list.** Each host a connection reaches is
  decided on its own.

### Folders

- **A folder is granted for reading or for changing**, by its whole real path.
  Reading a folder outside the workspace puts something private within reach
  (ADR 0012).
- **A folder granted for changing is watched and saved like the workspace**
  (ADR 0031), whatever its size. The card says how much of the undo budget is
  free.
- **What is never granted**, for reading or changing: a drive, the person's
  user folder or a folder holding it, a network share, a drive that keeps no
  permissions, Zhiyin's own folders, and the stores of credentials: `.ssh`,
  `.aws`, `.azure`, `.config\gh`, `.git-credentials`, `.npmrc` and `.pypirc`,
  browser profiles, Windows' credential folders and the vaults of the password
  managers Zhiyin lists. What is never granted for changing: `Windows`,
  `Program Files` and every Startup folder. A credential reaches a command only
  through a command with full access, one at a time.
- **The grant follows no link out of its folder.** A folder holding a link,
  junction or mount point that leads outside it is refused. A file with more
  than one name gets no permission entry, since an entry belongs to the file
  and would reach its other names too; the card says how many files that
  leaves out.
- **A grant's permission entries are removed** when no conversation holds the
  grant any longer.

### Where the container is unavailable

- **Without a container the shell asks every time**, with full access, as it
  does without this decision. That is the case when Windows lacks what the
  container needs, when the shell fails its start check in a container, or
  when containment fails for the run. The shell's description says which case
  holds.

## Why

The shell was the one capability whose reach nothing bounded, so its safety
rested on a person reading every command, and people stop reading: Anthropic
reports that users accept 93% of permission prompts, and a study of 290 public
reports of coding agents misusing files counts 80 caused by approval fatigue.
Sealing commands off is what reduces prompts without lowering the bar:
Anthropic measured 84% fewer prompts with its sandbox, Cursor 40% fewer stops,
and agents that ask only when a command must leave its sandbox ask about half
as often or less than those that ask per command.

Reading a command's text does not bound it. Allowlists and parsers keep being
bypassed: Claude Code has some fifteen advisories for parsing alone, Roo Code
and Cursor have the same kind, Codex removed its list of safe commands, and git
runs helpers named in a repository's configuration even for commands that only
read. A boundary the kernel holds needs no reading of the command at all.

An app container is the boundary Zhiyin already uses: it limits reading,
writing and the network, needs no administrator, and its folder grants, homes
and proxy exist. Measured on 2026-11-20 on Windows 11 Home 22631 in a real
container: Git Bash does not start (status `0xC0000142`), since its Unix
runtime fails in a container until a fix under review ships; busybox-w32
starts in about a quarter of a second and runs substitution, subshells,
pipes, loops, file writes and background jobs, failing only on `/dev/null`;
Git for Windows' git fails at every start, opening `/dev/null`. With Zhiyin's
patches, measured on 2026-11-21, busybox-w32 discards and ends `/dev/null`
itself, waits for every command it starts though a container cannot see its
parent, and hands git's calls through a pipe only its container may open.
busybox-w32 is
a native Windows program, maintained since 2012 and shipped as the Unix tools
of w64devkit. git through Zhiyin keeps git usable without the container and
without a repository's settings running anything.

Asking at the edge rather than at every command puts the card where a person
can judge it: whether to trust a website, or to open a folder. Granting a
folder or a website, rather than full access, keeps most steps outside bounded.
A website rather than a page matches what the proxy can tell apart. A grant
bound to what the card said keeps a click from covering a risk the person was
never shown, at the cost of at most one card each time a fact changes.

The costs: Zhiyin builds and updates its own busybox-w32; its shell is not
bash, so a bash-only command fails and is rewritten; a program that opens the
null device itself needs full access; a container's home starts empty, so a
tool's settings in the person's profile do not apply; a tool installed only in
the person's profile is out of reach; a website granted can receive what the
conversation can read; git through Zhiyin runs without the repository's hooks
and filters; servers the person opens go through a relay; and Windows builds
without the container's needs keep asking at every command.

## Rejected

- Asking for every command: it trains people to approve without reading.
- Allowing commands by prefix, classification, parsing or the model's
  description: nothing in a command string bounds what it reaches.
- A model judging which commands are safe, as the boundary: Anthropic's
  classifier misses 17% of the risky actions it is measured on, and Cursor
  says its own is no boundary.
- The model declaring a command's risk: a page can tell it what to declare.
- Git Bash in the container: it does not start there until the MSYS2 runtime's
  fix for containers (msys2-runtime pull request 403, open on 2026-11-20)
  ships in a Git for Windows release.
- brush, a bash-compatible shell in Rust: it ran the same commands, but its
  project calls its Windows support experimental.
- Windows PowerShell: models write POSIX shell far more reliably, and in a
  container it could not use its working folder.
- git in the container: it opens the null device at every start.
- A write-restricted token as the shell's container: it bounds writes only,
  leaves reading and the network open, still needs integrity labels to stop
  deletes through a parent folder, and Git Bash does not start under the one
  Codex uses.
- A separate Windows account with a firewall block: it needs an administrator
  and a new account on the person's computer, its network block has
  documented ways round, and a firewall filters addresses, not the websites
  the person names.
- Microsoft Execution Containers: its process containers are app containers,
  so it adds nothing Zhiyin lacks, and it needs a newer Windows than the
  container itself.
- Windows Sandbox, WSL or Docker: not on Windows Home, or an install of their
  own, and Linux instead of the person's Windows programs.
- Detecting paths outside the folder in a command: a warning shown only when a
  path is recognised teaches that no warning means safe.
- One-page grants: the proxy sees hosts, not pages.
- Grants for a project or remembered across conversations: they would reach
  work the person has not seen start.
- Holding a connection open while the card waits: a tool times out while the
  person reads, so the host is refused at once and the model asks.
- This computer's loopback for commands: Zhiyin's servers and every
  unauthenticated local service would be reachable.

## Assumptions

- busybox-w32's shell and tools cover what models run in a shell, and a model
  told the shell is not bash rewrites what fails.
- Programs started with a redirect to the shell's null device work as they do
  with `NUL`; the programs that open `NUL` themselves are few in what models
  run sealed off.
- The settings listed above are every way a repository's configuration makes
  git run a program; git's own documentation is checked at each git update.
- Node, Python and the programs models run in a container resolve the files
  they need on this Windows; where Node resolves real paths and Windows refuses
  it, Node is told to keep the paths as given.
- git over HTTPS through the proxy checks certificates without failing on
  revocation, as `curl.exe` does (ADR 0006).
- A port carried from this computer's loopback into a container reaches a
  server listening on the container's loopback.
- Program-held stores of credentials are where the list says; one Zhiyin does
  not list can be granted for reading.
- The Public Suffix List names the suffixes under which anyone can have a name.
