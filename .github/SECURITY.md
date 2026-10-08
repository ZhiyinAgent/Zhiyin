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
account and does not make that account a sandbox: an action you approve can
do whatever your account can do. The sections below say what each boundary
contains and where it stops.

### Approvals

Zhiyin runs these without asking: reading, listing and searching inside the
folder you chose; reading what an enabled plugin contains, and activating it;
checking on or stopping a command you already approved; and what stays inside
the conversation, such as asking you questions, giving you a quiz, keeping its
plan, drawing charts and diagrams, and handing work to a specialist, whose own
actions follow these same rules. Everything else asks: creating, changing or
deleting files, reading outside the folder, every shell command, and every
call to a connector, including the browser, Git, Python and the document
compiler.

The rule reads what an action's implementation declares, and only Zhiyin's
built-in tools are trusted to declare a read. A tool's name earns nothing,
and neither does a connector's description of itself, including the
connectors that ship with Zhiyin.

An approval covers the exact request you saw. Before an approved action runs,
Zhiyin inspects it again, and if its target changed while it waited, it does
not run.

For edits inside one folder below the one you chose, or for one connector
tool, you can allow the action for the rest of the conversation, and take
that back from the conversation's menu. Deletions, shell commands and Python
scripts ask every time.

### The folder you choose

File tools have nothing to work on until you choose a folder. Creating,
editing and deleting files is refused outside it; reading or listing outside
it asks first. Each path is checked when the request is inspected and again,
with links resolved, when it runs, so a link or a replaced file cannot carry
an operation outside the folder.

Before a file changes, Zhiyin keeps a copy, so going back in a conversation or
undoing a turn can restore it. Copies are bounded: 10 MiB per file and
256 MiB in all, kept for 30 days. Deletions go to the Recycle Bin by default,
and the approval says which items would be deleted for good, either because
the model asked for that or because Windows will not take them. Going back
and undoing cover files on this computer; what a connector or a website did
at its end stays done.

### Shell commands and Python

Shell commands run in the bash that comes with Git for Windows, starting in
the folder you chose. That starting folder is not a boundary: a command has
your account's access to files, processes, the network and credentials. Read
the whole command before approving it, including paths, redirections,
downloads and the programs it starts. The model's explanation of a command is
a claim, and the approval labels it as one.

A command that deletes files is refused before you are asked, and the model
is pointed to the delete tool, which shows each item and whether it can be
restored. This reads the command's text, including nested shells and inline
Python or Node code; a program that deletes files by itself is covered by your
approval of the command.

After a command, Zhiyin lists by name the files in the folder that changed
while it ran. It keeps no copy of them, so they cannot be restored. The list
leaves out changes outside the folder and in folders that searches skip, and
there is no list when the folder holds more than 20,000 files.

Python scripts run in an environment Zhiyin manages, kept apart from your own
projects. That separation keeps packages apart; it is not a security
boundary, and a script has the same access as a shell command.

### Processes Zhiyin starts

Shell commands, the browser, Git, Python, the document compilers and file
search start suspended, are placed in a Windows Job Object that ends
everything in it when it closes, and only then resume. The process that draws
PDF pages joins a Job Object with a memory limit before it is given a
document. Stopping a conversation ends its commands and closes its browser;
quitting, or Zhiyin ending abruptly, ends every process tree it started. If
Job Objects are unavailable, the shell is not offered.

Job Objects govern how long processes live, not what they can reach. They do
not limit file, registry, network or credential access, and they do not cover
programs started outside Zhiyin.

### The browser

Each conversation gets its own headless Edge, or Chrome when Edge is missing,
on a temporary profile that is removed when the browser closes. It never uses
your own browser profile, cookies or sign-ins. Zhiyin drives it over pipes
only Zhiyin holds, and the browser listens on no network port. While it runs,
its profile is on disk and readable by programs running as your account.

Web pages are untrusted. What they say reaches the model marked as untrusted
tool output, and it grants nothing. To preview files from your folder, Zhiyin
serves them read-only from a loopback address with a random token, and only
files inside the folder.

### Connectors

Remote connectors use Streamable HTTP MCP. Their tool descriptions and
results are untrusted, and a server's own read-only labels are ignored, so
every call asks unless you allowed that tool for the conversation.

A connector takes a pasted key or, where its service offers the standard MCP
sign-in (OAuth 2.1 with PKCE), a sign-in in your own browser. During a
sign-in, Zhiyin listens on a loopback address for the service's redirect.
Tokens are refreshed automatically. Signing out forgets the sign-in on this
computer; it does not revoke it at the service.

### Keys and saved data

The OpenRouter key and every connector's key or sign-in are kept in Windows
Credential Manager, and only the main process reads them. The window can save
or clear a key and learn whether one is stored, but never reads one back. If
the credential store is locked or unavailable, Zhiyin says so, and work that
needs a stored key cannot run. For development, `OPENROUTER_API_KEY` can
supply the provider key instead.

Everything else lives in `%APPDATA%\Zhiyin`: conversations exactly as sent to
the model, including any secret a tool returned, pictures, pastes, saved
outputs, file copies, usage and logs. Zhiyin sends none of it anywhere on its
own: conversation content leaves the computer only as a conversation sends it
to its model, through OpenRouter, and to its connectors.

Exported conversations have credentials in recognised formats removed, such as
`Authorization` headers, bearer tokens and common key prefixes. Recognition
cannot prove that none remain, and each export says so.

### The app window

The window runs sandboxed, with context isolation, no Node.js integration and
a content security policy. It cannot navigate away or open new windows, and
the main process accepts commands only from the app's own top frame. The
installed executable has Electron's run-as-Node and inspector switches
turned off, so another program cannot run its own code as Zhiyin.

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
