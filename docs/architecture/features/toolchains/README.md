# Toolchains

## Purpose

Installs the external programs some connectors need — Typst, Tectonic, `uv` —
on request, from a pinned address and against a pinned fingerprint. It exists
so those connectors can be honest about their prerequisites (ADR 0045): a
connector says what it needs, a person agrees to the download, and nothing
partial is ever usable.

## Boundaries

- **Owns:** the pinned release of each program, downloading it, verifying it,
  unpacking it into application data, reporting its state, and answering where
  the installed program is.
- **Does not own:** which connector needs which program (capabilities), running
  a program (the connector that needs it), or the management surface (renderer).
- **Talks to other features only through:** `state`, `install`, and
  `executable`.

## Public interface

- `state(id)` answers `ready`, `missing` with what installing would download
  (name, version, size, source), `installing`, or `failed` with a reason a
  person can read.
- `install(id, signal?)` downloads, verifies, unpacks, and promotes one
  program. Asking twice while it runs joins the running installation.
- `executable(id)` answers the installed program's path, or nothing.
- `pinnedToolchains` is the shipped list: each program's version, URL, SHA-256,
  size, source, and the path of the program inside its archive.

## Invariants

- **A download is used only if it matches its pinned fingerprint and size.**
  Anything else is discarded, the failure is reported, and nothing is
  installed. Named tests: `discards a download that does not match its
  fingerprint` and `stops reading a download that grows past its published
  size`.
- **Nothing partial is ever usable.** An installation is assembled in a staging
  folder and promoted whole; an interrupted or failed one leaves no staging
  folder and no program. Named tests: `leaves nothing usable behind when
  installation is stopped` and `installs a verified archive and finds the
  program after a restart`.
- **An archive may not reach outside its own folder.** Entries that climb out
  or link elsewhere are refused. Named test: `refuses an archive whose entries
  climb out of its folder`.
- **An archive that does not contain the program is refused.** Named test:
  `refuses an archive that does not contain the program`.
- **One installation, however many ask.** Named test: `downloads once when
  installation is asked for twice at the same time`.
- **One version is kept: the pinned one.** Named test: `replaces an older
  installed version with the pinned one`.
- **Every pinned release names an https GitHub release, a size, and a full
  digest.** Named test: `name an https GitHub release, a size, and a full
  SHA-256 digest`.

## Testing notes

Tests build real zip archives byte by byte and unpack them with the real
`tar.exe` that ships with Windows, because the refusal that matters — an entry
that climbs out of its folder — is that program's behavior, not ours. The
download is replaced, so no test reaches the network.

## Open questions

- Only Windows x64 is pinned, which matches the app's supported platform
  (ADR 0004). Another platform needs its own pinned releases.
- A program is verified when it is installed, not before each use. A person who
  replaces the file afterwards is trusted, the same way the shell tool trusts
  the `git` on the machine.
