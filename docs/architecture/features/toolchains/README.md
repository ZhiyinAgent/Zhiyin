# Toolchains

## Purpose

Installs the external programs some connectors need (Typst, Tectonic, Blender and `uv`)
when the person asks, from a pinned address and checked against a pinned
fingerprint. A connector says what it needs, the person agrees to the
download, and only a complete, verified install is ever used (ADR 0020).

## Boundaries

- **Owns:** the pinned release of each program, downloading it, verifying it,
  unpacking it into the app's data folder, when a program is made ready,
  reporting its state, and answering where the installed program is.
- **Does not own:** which connector needs which program (capabilities),
  running a program or knowing what readies it (the feature that uses it), or
  the screen that manages them (renderer).
- **Talks to other features only through:** `state`, `install` and
  `executable`.

## Public interface

- `state(id)` answers `ready`; `missing`, with what installing would download
  (name, version, size, source); `installing`, with how much of the download
  has arrived of its size; or `failed`, with a reason a person can read.
- `install(id, signal?)` downloads, verifies, unpacks and moves one program
  into place.
- `executable(id)` answers the installed program's path, or nothing.
- `ready`, given when the installer is built, names by program id a step
  that makes an unpacked program ready to use. It is told where the program
  is now and where it will be once installed.
- `pinnedToolchains` is the shipped list: each program's version, URL,
  SHA-256, size, source, and the program's path inside its archive. Every
  entry is an https download for Windows x64 from the source it names: the
  project's GitHub releases, or for Blender its own download site.
- `DownloadedToolchains` implements `Toolchains`, given the network to
  download through (ADR 0004), and `windowsTarUnpack`, which unpacks with
  Windows' own bsdtar and refuses an entry that would leave the folder. `fetchDownload` downloads over Node's own `fetch`, for scripts run
  outside the app.
- The types these take and return: `ToolchainDownload`, `ToolchainState`,
  `ToolchainSpec`, `Download`, `Ready`, `Unpack`.

## Invariants

- A download is used only if its size and SHA-256 match the pinned ones. A
  download that grows past its size is stopped; a mismatch is discarded and
  reported, and nothing is installed. A download that cannot be written, as on
  a full disk, fails the install, which can then be tried again.
- Nothing partial is ever used. An install is assembled in a staging folder
  and moved into place whole; a stopped or failed one leaves neither a staging
  folder nor a program. A stopped one is not a failure: the program is offered
  as before. What an install cut short by Zhiyin closing left is
  cleared before the next install begins.
- An archive may not reach outside its own folder: entries that climb out, and
  links of any kind, are refused. Archives are unpacked with the `tar.exe`
  that ships with Windows, called by its full path.
- An archive that does not contain the expected program is refused.
- A program with a readying step is readied once, after it is verified and
  before it is in place, so what the step makes is installed with it. A step
  that fails does not fail the install, since the program works without it; an
  install stopped during the step leaves nothing.
- A program is installed once, however many ask at the same time. One
  asked for while a stopped install is still ending starts once it has ended.
- Only the pinned version is kept; installing it removes any other.
- A program is verified when it is installed. After that it is found through a
  marker naming the pinned version and digest, so a new pin makes an older
  install read as missing.
- A download goes through the network the installer is handed, following the
  redirects release sites send. Node's own `fetch` serves only when none is
  handed in.

## Testing notes

Tests build real zip archives byte by byte and unpack them with the real
`tar.exe`, because refusing an entry that climbs out is that program's
behavior. The download is replaced, so no test reaches the network.
