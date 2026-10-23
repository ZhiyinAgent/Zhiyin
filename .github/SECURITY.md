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

Zhiyin shows every action it takes and asks before any that could change
something or reach beyond the folder you chose. It runs as your Windows
account and does not make that account a sandbox: a shell command you approve
can do whatever your account can do. Python scripts, Blender and LaTeX run in
Windows app containers, which reach only the folders Zhiyin gives them. The
sections below say what each boundary contains and where it stops.

### Approvals

Zhiyin runs these without asking: reading, listing and searching inside the
folder you chose; reading what an enabled plugin contains, and activating it;
checking on or stopping a command you already approved; and what stays inside
the conversation, such as asking you questions, giving you a quiz, keeping its
plan, drawing charts and diagrams, and handing work to a specialist, whose own
actions follow these same rules. Everything else asks: creating, changing or
deleting files, reading outside the folder, every shell command, and every
call to a connector, including the browser, Git, Python, the 3D studio and the
document compiler.

The rule reads what an action's implementation declares, and only Zhiyin's
built-in tools are trusted to declare a read. A tool's name earns nothing,
and neither does a connector's description of itself, including the
connectors that ship with Zhiyin.

An approval covers the exact request you saw, and shows each of its inputs
whole, however long. A browser action on part of a page has to say in words
what it acts on; its approval shows that, the selector it aims by and how it
clicks or types, but not the browser's internal reference to the element.
Before an approved action runs, Zhiyin inspects it again, and if its target
changed while it waited, it does not run.

For edits inside one folder below the one you chose, for one connector tool,
for work on the open 3D scene that writes only new files, or for Python
scripts that reach only the folder you chose and not the internet, you can
allow the action for the rest of the conversation, and take that back from the
conversation's menu. Deletions, shell commands, Blender scripts, Python
scripts that use the internet, changes to a Python environment, and Git's
staging, committing, stashing and branch creating and switching, which run
the repository's own hooks and filters or change its files, ask every time.

### The folder you choose

File tools have nothing to work on until you choose a folder. Creating,
editing and deleting files is refused outside it; reading or listing outside
it asks first. Each path is checked when the request is inspected and again,
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

Before a file changes, Zhiyin keeps a copy, so going back in a conversation or
undoing a turn can restore it. Copies are bounded: 10 MiB per file and
256 MiB in all, kept for 30 days. Deletions go to the Recycle Bin by default,
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

After a command, Zhiyin lists by name the files in the folder that changed
while it ran. It keeps no copy of them, so they cannot be restored. The list
leaves out changes outside the folder and in folders that searches skip, and
there is no list when the folder holds more than 20,000 files.

### Python

Python scripts run in environments Zhiyin manages, kept apart from your own
projects, and in a Windows app container. A script reads Zhiyin's own Python,
its environment and its own code, and changes only the folder you chose:
Windows refuses it every other file your account can reach, for reading as
for writing, and holds a program it starts, a shell included, to the same
limits. A file kept elsewhere has to be copied into the folder before a script
can read it. A script run from a file in the folder is shown as the code the
file holds and runs from a copy of it; if the file changes after you approve,
it does not run. A script uses the internet only when its request asks for it,
and the approval says so. Scripts with and without the internet keep separate
homes for their temporary files, so what one without it leaves is never read
by one that could send it on.

The model can make further environments, each with its own Python version and
packages. A package it asks for is installed by the environment's own
installer, pip, in an app container that changes only that environment and
can use the internet, so whatever the package's own code does as it installs,
Windows refuses it your files. Zhiyin's `uv` makes environments and installs
the default environment's packages outside a container, as ready-built
packages whose own code does not run to install them. Those packages are the
versions published by a date fixed with each release of Zhiyin, pinned in a
list Zhiyin keeps with the SHA-256 of each file, so a file that differs,
whether a proxy in between or the index itself serves it, is refused rather
than installed. Each
environment's pip is the version published by that date. Python, pip and `uv`
are given only Windows' own variables and your proxy and certificate settings,
so a variable left in your environment does not point them elsewhere, and a
key kept in a variable does not reach a script, apart from a password written
into a proxy's address.

### 3D scenes

Each conversation's 3D work runs in its own Blender, which Zhiyin installs
and starts without a window, on its own settings: it ignores your Blender
preferences, add-ons and startup file, and never runs a script saved in a
scene file. Its settings and add-ons are emptied before each start and it
may not change them, so nothing a script leaves runs at a later start. It is
given only Windows' own variables and your proxy and certificate settings, so
a key kept in a variable does not reach a script. Blender runs in a Windows
app container: it reads its own installation, the script that starts it and
its conversation's folder in Zhiyin's data, changes only the folder you chose
and its working folders there, and cannot use the network. Windows
refuses it, and every program it starts, every other file your account can
reach, for reading as for writing. A model file is brought in only when the
files it names, such as its pictures, geometry and parts, are inside the
folder you chose, read as the importer reads them; a USD file that names one
in a way that cannot be read the same way, or USD text that plays clips, is
refused. A Blender script asks every time, and its approval says what it can
reach; going back restores only the scene file.

### Documents

The document compiler builds a PDF from a Typst or LaTeX file in the folder
you chose, and asks each time, unless you allowed compiling that document for
the rest of the conversation. A Typst document can name files in that folder
only. LaTeX never runs a program a document names, and it runs in a Windows
app container: it reads the folder you chose, its own installation and the
packages Zhiyin keeps for it, changes only a folder of that compile's own in
Zhiyin's data, and uses the internet to fetch packages. It can change none of
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

### Connectors

Remote connectors use Streamable HTTP MCP. Their tool descriptions and
results are untrusted, and a server's own read-only labels are ignored, so
every call asks unless you allowed that tool for the conversation. To list a
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
- Developer-preview installers are not code-signed yet and do not update
  themselves, so Microsoft Defender SmartScreen warns before they run.
- Pull-request CI runs the gate, which needs no credentials. Checks against a
  live provider or remote connectors need credentials and run outside it.

A report showing that Zhiyin breaks one of these stated boundaries is a
security report.
