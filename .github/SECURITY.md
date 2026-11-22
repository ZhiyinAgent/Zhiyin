# Security policy

## Reporting a vulnerability

Report a suspected vulnerability privately, never in a public issue,
discussion or pull request. Use **Report a vulnerability** on this
repository's Security tab, or email `contact@zhiyinagent.app`.

Include the affected version or commit, your Windows and browser versions, the
steps to reproduce, the impact you saw, and whether the report holds sensitive
data. Do not send credentials, private files or destructive proof-of-concept
data unless a secure exchange has been agreed.

Reports against the latest `main` commit and the most recent developer preview
are in scope. Older previews are not a maintained release line; they get fixes
where that is practical.

## What each boundary covers

Zhiyin shows every action it takes. A change in the folder you chose runs
without asking, because Zhiyin backs the file up first and can put it back;
Zhiyin asks before what it can neither prevent nor undo. It runs as your
Windows account and does not make that account a sandbox: a shell command you
approve can do whatever your account can do. Python scripts, CAD builds,
Blender and LaTeX run in Windows app containers, which reach only the folders
Zhiyin gives them. The sections below say what each boundary contains and
where it stops.

### Approvals

Each action is decided by what its implementation declares it does: what it
reads, what it changes and whether Zhiyin can put that back, where it sends,
whether it acts as you on an account, what code it runs, whether it leaves
something that runs later, and whether it brings in content someone else
wrote. Only Zhiyin's own code is trusted for this: a built-in tool, a
connector that ships with Zhiyin, or a built-in plugin's manifest, which
Zhiyin wrote. A connector you added is not, whatever it says of itself, and a
tool's name earns nothing. What an action does not declare is read as the
worst case, and the strictest part of what it does decides it.

- **Runs without asking:** reading the folder you chose or Zhiyin's own
  records; reading your account on a service through a connector that ships
  with Zhiyin; changing the folder you chose in a way Zhiyin backs up first,
  and moving a file there to the Recycle Bin; code sealed off in an app
  container, such as a Python script, a CAD build or a Blender call; and
  sending to a fixed service you connected, such as a web search. Each is
  shown in the conversation, and a change with a way back.
- **Asks every time, and nothing allowed for the conversation covers it:**
  code with your account's full access, such as a shell command or a Git
  change, which runs the repository's own hooks and filters; deleting for
  good, or any other change Zhiyin cannot put back, unless all it cannot put
  back is one file too large for the undo budget; acting as you on an account
  in a way that cannot be taken back, such as merging or pushing, or without
  naming where; installing packages, or making or rebuilding a Python environment,
  whose code later scripts run; deleting or moving anything outside the
  folder you chose; and anything that leaves something to run later on its
  own, such as a file in a `.git` or Startup folder.
- **Asks, and can be allowed for the conversation:** reading or changing a
  file or folder outside the folder you chose, by that file or folder, never
  a whole drive, your user folder or one holding it; acting as you on an
  account, by the place it lands, such as one repository; changing one file
  too large for the undo budget, by that file; and each tool of a connector
  you added, unless you chose beside its switch that it only reads, which is
  your word and not something Zhiyin can check, or that it is asked about
  every time.
- **Sending what the model wrote to a destination it chose** runs, unless
  the conversation holds both content someone else wrote and something
  private; then it asks every time. Such a send is text typed into a page,
  keys pressed or code run in it, a file uploaded, a Python script with the
  internet, a preview of your files, whose own code then runs, or an address
  the model wrote. Content someone else wrote is a web page, a search result,
  an answer from a connector you added, or a file Windows marks as
  downloaded; something private is files in the folder you chose that this
  conversation did not make, anything read outside it, or your account on a
  service once it was read. A memory carries both facts from the
  conversation that kept it. A click, or opening an address that came whole
  from your messages or from a page, carries nothing the model wrote, and
  runs.

What stays inside the conversation runs too: asking you questions, giving
you a quiz, keeping its plan, drawing charts and diagrams, reading what an
enabled plugin contains, and handing work to a specialist, whose own actions
follow these same rules.

An approval covers the exact request you saw, and shows each of its inputs
whole, however long. A browser action on part of a page has to say in words
what it acts on; its approval shows that, the selector it aims by and how it
clicks or types, but not the browser's internal reference to the element.
Before an approved action runs, Zhiyin inspects it again, and if its target
changed while it waited, it does not run.

A grant for the conversation takes one click and names how far it reaches. A
grant for a file outside the folder you chose ends once the file is changed
outside Zhiyin, and one for a file too large for the undo budget once its
size or time of change differs from how the conversation left it. A grant for a place on an
account covers that place alone, across the connector's tools. No grant
covers a file in a `.git` or Startup folder, whose contents run later. Every
grant can be taken back under Permissions, in the conversation's menu.

### The folder you choose

File tools have nothing to work on until you choose a folder. Creating or
editing a file outside it asks, naming its whole real path, and can be
allowed for the conversation by that file or its folder; deleting outside it
asks every time, by its whole path, and goes only to the Recycle Bin; reading
or listing outside it asks first. Zhiyin's own data
and program folders are never written, whatever you approve. Each path is checked when the request is inspected and again,
with links resolved, when it runs. That check holds for the moment it is
made: a file replaced by a link after it, while the operation runs, is not
checked again. A hard link is a file's second name, as real as its first, so
a file the folder holds through one counts as part of the folder; package
managers such as pnpm fill `node_modules` with them. Git's tools that only
read a repository start none of the programs it names, such as its hooks,
filters or file monitor; they need Git 2.31 or newer, and refuse an older one.
Git's tools act only on the repository the folder holds: where a repository's
own files send git to another folder, or to another repository's history or
objects, through its settings, a file or a link, they run nothing.

Zhiyin keeps each file of the folder you chose, and of each folder outside it
you allowed the conversation to change, as each message found it, saved the
first time anything writes it during the turn, so going back in a
conversation or undoing a turn can restore it. What is kept takes no more
room than the undo budget you set in Settings, at first the smaller of 50 GB
and a tenth of the disk's free space; to fit it, older versions are let go
of, and the file as it was before the conversation first changed it goes only
when you say so. Deletions go to the Recycle Bin by default,
and the approval says which items would be deleted for good, either because
the model asked for that or because Windows will not take them. Going back
and undoing cover files on this computer; what a connector or a website did
at its end stays done.

### Shell commands

Shell commands run in the bash that comes with Git for Windows, starting in
the folder you chose. That starting folder is not a boundary: a command has
your account's access to files, processes, the network and credentials. Read
the whole command before approving it, including paths, redirections,
downloads and the programs it starts. The model's explanation of a command is
a claim, and the approval labels it as one.

A command that deletes files is refused before you are asked, and the model
is pointed to the delete tool, which shows each item and whether it can be
restored. This reads the command's text, including nested shells and inline
Python, Node or PowerShell code, and catches the usual ways to delete, not
every way: any program can delete files. A script the model wrote earlier,
code that hides the call, or a command that overwrites a file still deletes
without being caught, and only your approval of the command covers it.

After a command runs, Zhiyin records every file the command created, changed
or deleted in the folder you chose, against the files as the turn found them,
so going back or undoing the turn puts each back. This covers files Git
ignores, however many the folder holds, but leaves out `.git` and the folders
tools rebuild (`node_modules`, `build`, `dist`, `out`, `.next`, `.venv` and
`__pycache__`). A first write the undo budget has no room for asks you first:
change the file without a way back, make room, or refuse the write. Zhiyin
watches up to 20,000 files at once; past that, it saves the smallest at once
until the rest fit, and the largest left over cannot be put back unless the
model saves each with `prepare_change` before changing it. When the folder
could not be watched, Zhiyin lists by name the files that changed while the
command ran, where it can, and going back can only remove those the command
created. Nothing a command does outside the folder is kept or listed, and
none of it can be undone. A junction or symbolic link in the folder, which a
command can make pointing anywhere, is recorded and put back as a link and
never followed: Zhiyin does not read, save or watch what it leads to, and a
file whose path now passes through one, such as a folder replaced by a
junction to your `.ssh` folder, is left as a conflict with nothing written
there. While a file is put back, the folders on its way are held open so
that nothing can rename them or swap one for a link, and each is checked on
that handle; a file is saved only from a handle checked to be the file its
path names through real folders. A link swapped in at any moment is caught,
not only one made before the check.

### Python

Python scripts run in environments Zhiyin manages, kept apart from your own
projects, and in a Windows app container. A script reads Zhiyin's own Python,
its environment and its own code, and changes only the folder you chose:
Windows refuses it every other file your account can reach, for reading as
for writing, and holds a program it starts, a shell included, to the same
limits. A file kept elsewhere has to be copied into the folder before a script
can read it. Zhiyin records what a script changed as it does for a command,
so going back puts back what the script changed; a file it could not save
first is read-only to the script for that run, unless the call names it,
which asks, or the model saves it with `prepare_change`. A script run from a file in the folder is shown as the code the file
holds and runs from a copy of it; if the file changes between being shown and
running, it does not run. A script reaches no network unless its request
names hosts, and then only those hosts, over HTTPS, through a proxy in Zhiyin
that only that script's container can open; every other host is refused, and
a program that ignores the proxy reaches nothing. Its card names the hosts,
and what it reached, with what it sent to each. Scripts that name hosts and
scripts that do not keep separate homes for their temporary files, so what
one that reaches no network leaves is never read by one that could send it on.

The model can make further environments, each with its own Python version and
packages. A package it asks for is installed by the environment's own
installer, pip, in an app container that changes only that environment and
reaches only the package index, so whatever the package's own code does as it
installs, Windows refuses it your files and the proxy every other host. Zhiyin's `uv` makes environments and installs
the default environment's packages outside a container, as ready-built
packages whose own code does not run to install them. Those packages are the
versions published by a date fixed with each release of Zhiyin, pinned in a
list Zhiyin keeps with the SHA-256 of each file, so a file that differs,
whether a proxy in between or the index itself serves it, is refused rather
than installed. Each
environment's pip is the version published by that date. Python, pip and `uv`
are given only Windows' own variables and your certificate settings, so a
variable left in your environment does not point them elsewhere, and a key
kept in a variable does not reach a script. Zhiyin's proxy goes out the way
Zhiyin's own requests do, through your computer's proxy when it has one, so
that proxy's address and any password in it stay in Zhiyin.

### 3D scenes

Each conversation's 3D work runs in its own Blender, which Zhiyin installs
and starts without a window, on its own settings: it ignores your Blender
preferences, add-ons and startup file, and never runs a script saved in a
scene file. Its settings and add-ons are emptied before each start and it
may not change them, so nothing a script leaves runs at a later start. It is
given only Windows' own variables and your certificate settings, so a key
kept in a variable does not reach a script. Blender runs in a Windows
app container: it reads its own installation, the script that starts it and
its conversation's folder in Zhiyin's data, changes only the folder you chose
and its working folders there, and cannot use the network. Windows
refuses it, and every program it starts, every other file your account can
reach, for reading as for writing. A model file is brought in only when the
files it names, such as its pictures, geometry and parts, are inside the
folder you chose, read as the importer reads them; a USD file that names one
in a way that cannot be read the same way, or USD text that plays clips, is
refused. A Blender script runs without asking, and its card says what it can
reach: Zhiyin copies the folder you chose before it runs, so going back puts
back every file it changed there, the scene included.

### Documents

The document compiler builds a PDF from a Typst or LaTeX file in the folder
you chose without asking, keeping a copy of a PDF it compiles over; writing
the PDF outside that folder asks, by its whole path. A Typst document can name files in that folder
only. LaTeX never runs a program a document names, and it runs in a Windows
app container: it reads the folder you chose, its own installation and the
packages Zhiyin keeps for it, changes only a folder of that compile's own in
Zhiyin's data, and reaches only the servers its packages come from. It can change none of
the packages it reads, so no document changes the packages a later one reads.
Each compiler lists the files it read; when a document read one outside the
folder, by name or through a link, nothing the compiler made or printed is
kept or shown. When the list is missing, nothing the compiler made is kept and
Typst's output is not shown. LaTeX's errors are shown all the same, since
LaTeX stops before listing what it read on errors as common as a missing file.
They can quote what LaTeX reads: the folder you chose, its packages and what
Windows opens to every app container, such as Windows' own files and the fonts
installed for everyone, never your own files outside the folder. Both
compilers download the packages a document needs.

### Downloads and mirrors

Zhiyin installs Typst, Tectonic, Blender and `uv` when you ask, each pinned
to one release by its size and SHA-256; a download that differs is
discarded. Each comes first from its own project: its GitHub release, or
Blender's download site. When that cannot be reached, as from many networks
in mainland China, the same release comes from a mirror: Tsinghua
University's (`mirrors.tuna.tsinghua.edu.cn`, `pypi.tuna.tsinghua.edu.cn`)
for Blender and `uv`, and Zhiyin's own unchanged copies on
`media.zhiyinagent.app` for Typst and Tectonic. A mirror is held to the
fingerprint pinned for the file it serves, so it can make an install fail
but not change what is installed. The same holds for Python, which `uv`
checks against its own fingerprints whether it comes from Astral, GitHub or
npmmirror (`registry.npmmirror.com`), and for the default and CAD
environments' packages, whose hashes are required from Tsinghua's copy of
PyPI as from PyPI. Three downloads are trusted by their host instead, from
the mirror as from the original: pip itself and the packages the model asks
for, which install in a container that reaches only their environment, and
Tectonic's TeX bundle, which Tectonic reads without checking it, from its
own server or from Zhiyin's copy, in its container. A newer model list is
read from GitHub, or from Zhiyin's copy of the same files, and taken only
when a key the app ships signed it. Every install offer and approval names
each place a step may download from.

### Updates

Zhiyin looks for a newer version of itself on GitHub's releases, or on
Zhiyin's copy of them on `media.zhiyinagent.app`, a few seconds after it
starts and every six hours, unless it is turned off in Settings. Nothing of
yours is sent. A release is taken only when a key the app ships for releases,
apart from the model list's, signed its version, installer name, size and
SHA-512; the signature is read before the installer is downloaded, and the
downloaded file is measured against it, again when you restart, and once
more just before it runs. An older or equal version is never taken. The
maintainers sign each release on their own computer, with keys kept off
GitHub, after checking the installer against the release workflow's checksum
and build attestation, so someone who takes over the repository or its
releases can stop updates but not choose what an installed copy runs.
Zhiyin installs an update only when you restart into it, and refuses to
restart while a conversation is working.

### Processes Zhiyin starts

Shell commands, the browser, Git, Python, Blender, the document compilers and
file search start suspended, are placed in a Windows Job Object that ends
everything in it when it closes, and only then resume. The process that draws
PDF pages joins a Job Object with a memory limit before it is given a
document. Stopping a turn ends its commands and leaves its browser and 3D
scene open; quitting, or Zhiyin ending abruptly, ends every process tree it
started in a Job Object. Three of Windows' own programs run without one, with
fixed arguments, and are not ended with Zhiyin: PowerShell, asked whether a
file would go to the Recycle Bin, which is ended after 30 seconds; `tar`,
unpacking a download whose checksum matched, which runs until it is done; and
`taskkill`, which ends PowerShell's run when its time is up. If Job Objects
are unavailable, the shell is not offered.

Job Objects govern how long processes live, not what they can reach. They do
not limit file, registry, network or credential access, and they do not cover
programs started outside Zhiyin.

App containers govern what Python, Blender and LaTeX reach. Besides the
folders a run is given, a contained program reads what Windows opens to every
app container, such as Windows' own files and the fonts installed for
everyone. A whole drive, a folder that holds your user folder, and a folder on
a drive that keeps no permissions, such as FAT or exFAT, are never given to
one: a run that needs one is refused, and says why. Giving a folder adds an
entry to its permissions that lets in only a container holding that folder's
capability, which only a program already running as you can start; the entry
stays after Zhiyin closes. Each home a run is given, such as a Python
environment's or a conversation's Blender's, has a container of its own, so
what one leaves in the folder Windows keeps for its container is not read by
another. Network shares are not tested.

### The browser

Each conversation gets its own headless Edge, or Chrome when Edge is missing,
on a temporary profile that is removed when the browser closes. It never uses
your own browser profile, cookies or sign-ins. Zhiyin drives it over pipes
only Zhiyin holds, and the browser listens on no network port. It opens only
web pages, at `https:` or `http:` addresses, whether the model or you send
it there, and stops its downloads once together they pass 1 GB. While it
runs, its profile is on disk and readable by programs running as your
account.

Web pages are untrusted. What they say reaches the model marked as untrusted
tool output, and it grants nothing. A specialist's report reaches the main
agent marked the same way, since the specialist may have read such a page. To
preview files from your folder, Zhiyin
serves them read-only from a loopback address with a random token, and only
files inside the folder.

Every connection the browser makes goes through a proxy inside Zhiyin, which
looks each address up itself. A website's page cannot reach your computer or
your local network through it; a page you or the model open there can. WebRTC
in it sends nothing past the proxy. Once the browser opens a preview of your
files, it reaches nothing but the preview and the addresses allowed for it,
until Zhiyin takes it elsewhere; nothing of the preview keeps running after
that. Allowing an address for the preview asks you when the conversation
holds content from outside and something private.

### Connectors

Remote connectors use Streamable HTTP MCP. Their tool descriptions and
results are untrusted, and a server's own read-only labels are ignored. A
connector that ships with Zhiyin has what each of its tools does declared in
its plugin's manifest, which Zhiyin wrote, and is decided by the rules above;
a tool the manifest does not name asks as a connector you added does. A call
to a connector you added asks unless you allowed that tool for the
conversation, or chose beside its switch that it only reads. To list a
connector's tools, Zhiyin connects to it without asking whenever a
conversation can use it, such as once a plugin it belongs to is active; that
sends the connector's key or sign-in and nothing from the conversation.

A connector takes a pasted key or, where its service offers the standard MCP
sign-in (OAuth 2.1 with PKCE), a sign-in in your own browser. During a
sign-in, Zhiyin listens on a loopback address for the service's redirect.
Tokens are refreshed automatically. Signing out forgets the sign-in on this
computer; it does not revoke it at the service.

### Keys and saved data

Each model provider's key, OpenRouter's or a lab's for each of its
platforms, and every connector's key or sign-in are kept in Windows
Credential Manager, and only the main process reads them. The window can save
or clear a key and learn whether one is stored, but never reads one back. If
the credential store is locked or unavailable, Zhiyin says so, and work that
needs a stored key cannot run. An automated run, such as a test of the
installed app, can supply a key instead through a variable named for Zhiyin,
such as `ZHIYIN_OPENROUTER_API_KEY`; no variable another tool reads is used.

Zhiyin's own requests, which carry these keys, go through Chromium's network
stack: they check certificates against Windows' certificate stores and use
Windows' proxy settings. `NODE_TLS_REJECT_UNAUTHORIZED` does not turn those
checks off.

Everything else lives in `%APPDATA%\Zhiyin`: conversations exactly as sent to
the model, including any secret a tool returned, pictures, pastes, saved
outputs, file copies, usage and logs. Zhiyin sends none of it anywhere on its
own: conversation content leaves the computer only as a conversation sends it
to its model, through OpenRouter or the lab's own API as the person chose,
and to its connectors.

Exported conversations and Zhiyin's logs have credentials in recognised
formats removed, such as `Authorization` and key headers, bearer tokens,
fields and variables named for a key, quoted or not, keys in a web address, a
password given to a command, private key blocks, and common key formats.
Recognition cannot prove that none remain, and each export says so.

### The app window

The window runs sandboxed, with context isolation, no Node.js integration and
a content security policy. It cannot navigate away or open new windows, is
granted no permission a web page could ask for, and shows a picture an answer
names as its words, without fetching its address. The main process accepts
commands only from the app's own top frame. The installed executable has
Electron's run-as-Node, `NODE_OPTIONS` and inspector switches turned off, so
another program cannot run its own code as Zhiyin.

## Environment

- Windows is the only supported operating system.
- Some websites block headless browsers.
- Model and connector behavior depends on external services and networks.
- Developer-preview installers have no Windows code signature, so Microsoft
  Defender SmartScreen warns before they run. An installed copy updates
  itself only from an installer the maintainers' release key signed.
- Pull-request CI runs the gate, which needs no credentials. Checks against a
  live provider or remote connectors need credentials and run outside it.

A report showing that Zhiyin breaks one of these stated boundaries is a
security report.
