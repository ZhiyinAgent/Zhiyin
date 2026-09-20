# Security policy

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, pull
request, or evaluation record.

Use GitHub Private Vulnerability Reporting for this repository when it is
available. If that channel is unavailable, email
`hotteletbastien@gmail.com`. Include the affected version or commit, Windows and
browser versions, reproduction steps, observed impact, and whether the report
contains sensitive data. Do not send credentials, private workspace contents,
or destructive proof-of-concept data unless a secure exchange has been agreed.

Reports against the latest `main` commit and most recent developer-preview alpha
are in scope. Older previews receive fixes only when the change is practical;
they are not a maintained release line.

## Operational boundaries

Zhiyin is designed to make authority visible, not to turn an ordinary Windows
account into a security sandbox.

### Selected workspace

Typed listing, search, and read tools may run without repeated approval only
when the resolved target remains inside the folder the person selected. Paths
are checked before approval and again at execution so a link or replacement
cannot silently redirect an approved operation outside that folder.

File creation, replacement, multi-file edits, deletion, instruction loading,
unknown built-ins, networked MCP calls, and shell execution require explicit
review under the current policy. An approval is bound to the inspected request;
it is not reusable permission for a changed target or effect. Recovery is
bounded and does not make every external effect reversible.

### Shell and external effects

A shell command starts in the selected workspace, but that working directory is
not a containment boundary. The command has the filesystem, process, and network
authority of the Windows user. Review the entire command and its stated effects,
including paths, redirections, subprocesses, downloads, and credentials. The
model's explanation is context, not proof that the command is safe.

Remote MCP servers and websites are external trust boundaries. Their
descriptions and returned content are untrusted, and an approved remote action
can have effects that local rewind cannot undo.

### Process containment

On supported Windows systems, Zhiyin starts owned command and browser process
trees suspended, assigns them to Windows Job Objects configured to terminate on
close, and only then resumes them. Stopping work, closing its owner, ordinary
shutdown, and abrupt application death are covered by regressions.

Job Objects provide lifecycle containment for processes Zhiyin launches. They do
not restrict those processes' file, registry, network, credential, or user-account
access; they do not cover programs started independently of Zhiyin; and they are
not a substitute for reviewing an action. If structural containment is
unavailable, the shell capability is not offered.

## Known environment limits

- Windows is the only supported operating system.
- Browser work uses an isolated, headless Edge profile, with Chrome as a
  fallback. Some websites block headless browsers, and Zhiyin never drives the
  person's existing browser profile.
- Provider and HTTP MCP behavior depends on external services and networks.
  Streamable HTTP bearer credentials are supported; interactive MCP OAuth and
  token refresh are not.
- Provider credentials use the Windows credential store when available. A
  locked or unavailable store is reported and can leave provider work
  unavailable.
- Developer-preview installers are unsigned, have no automatic update channel,
  and may trigger Microsoft Defender SmartScreen.
- CI uses deterministic local and installed-app regressions. Tests requiring a
  live provider credential are not run for pull requests.

These limits are part of the current preview's threat model. A report showing
that the implementation violates one of these stated boundaries is still a
security report.
