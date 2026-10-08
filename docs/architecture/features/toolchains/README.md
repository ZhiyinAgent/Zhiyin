# Toolchains

## Purpose

Installs the external programs some connectors need (Typst, Tectonic and `uv`)
when the person asks, from a pinned address and checked against a pinned
fingerprint. A connector says what it needs, the person agrees to the
download, and only a complete, verified install is ever used (ADR 0016).

## Boundaries

- **Owns:** the pinned release of each program, downloading it, verifying it,
  unpacking it into the app's data folder, reporting its state, and answering
  where the installed program is.
- **Does not own:** which connector needs which program (capabilities),
  running a program (the connector that needs it), or the screen that manages
  them (renderer).
- **Talks to other features only through:** `state`, `install` and
  `executable`.

## Public interface

- `state(id)` answers `ready`; `missing`, with what installing would download
  (name, version, size, source); `installing`; or `failed`, with a reason a
  person can read.
- `install(id, signal?)` downloads, verifies, unpacks and moves one program
  into place.
- `executable(id)` answers the installed program's path, or nothing.
- `pinnedToolchains` is the shipped list: each program's version, URL,
  SHA-256, size, source, and the program's path inside its archive. Every
  entry is an https GitHub release for Windows x64.

## Invariants

- A download is used only if its size and SHA-256 match the pinned ones. A
  download that grows past its size is stopped; a mismatch is discarded and
  reported, and nothing is installed.
- Nothing partial is ever used. An install is assembled in a staging folder
  and moved into place whole; a stopped or failed one leaves neither a staging
  folder nor a program.
- An archive may not reach outside its own folder: entries that climb out, and
  links of any kind, are refused. Archives are unpacked with the `tar.exe`
  that ships with Windows, called by its full path.
- An archive that does not contain the expected program is refused.
- A program is installed once, however many ask at the same time.
- Only the pinned version is kept; installing it removes any other.
- A program is verified when it is installed. After that it is found through a
  marker naming the pinned version and digest, so a new pin makes an older
  install read as missing.

## Testing notes

Tests build real zip archives byte by byte and unpack them with the real
`tar.exe`, because refusing an entry that climbs out is that program's
behavior. The download is replaced, so no test reaches the network.
