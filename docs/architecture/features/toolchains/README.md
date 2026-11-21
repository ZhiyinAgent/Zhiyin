# Toolchains

## Purpose

Installs the external programs some connectors need (Typst, Tectonic, Blender and `uv`)
when the person asks, and Zhiyin's own Node, which sealed-off shell commands
run (ADR 0029), when the first of them runs; each from pinned addresses and checked against pinned
fingerprints. Each comes first from its own project, and from a mirror when
that cannot be reached, as from many networks in mainland China (ADR 0027). A connector says what it needs, the person agrees to the
download, and only a complete, verified install is ever used (ADR 0017).

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
  (name, version, the largest of its downloads, and every place it may come
  from, each followed by the hosts it sends the download on to);
  `installing`, with how much of the download under way has arrived of its
  size; or `failed`, with a reason a person can read.
- `install(id, signal?)` downloads, verifies, unpacks and moves one program
  into place.
- `executable(id)` answers the installed program's path, or nothing.
- `ready`, given when the installer is built, names by program id a step
  that makes an unpacked program ready to use. It is told where the program
  is now and where it will be once installed.
- `pinnedToolchains` is the shipped list: each program's version and its
  sources in the order they are tried, each with its URL, SHA-256, size, the
  program's path inside its archive, and its hosts. Every source is an https
  download for Windows x64 from the host it names first. The first is the
  project's own: its GitHub release, or for Blender and Node its own
  download site. Then a mirror: Tsinghua University's copy of the same Blender
  zip; npmmirror's copy of the same Node zip; for
  `uv`, Astral's own wheel of the same release on Tsinghua's copy of the
  Python Package Index, which holds the same `uv.exe` at another path; and
  for Typst and Tectonic, Zhiyin's unchanged copies on
  `media.zhiyinagent.app`, at `toolchains/<id>/<version>/<file>`.
- `DownloadedToolchains` implements `Toolchains`, given the network to
  download through (ADR 0004), and `windowsTarUnpack`, which unpacks with
  Windows' own bsdtar and refuses an entry that would leave the folder. `fetchDownload` downloads over Node's own `fetch`, for scripts run
  outside the app.
- `limits`, given when the installer is built, sets how long a download
  waits for its site to answer and send its first bytes, and how long between
  two arrivals: 30 seconds each unless given.
- The types these take and return: `ToolchainDownload`, `ToolchainState`,
  `ToolchainSpec`, `ToolchainSource`, `DownloadLimits`, `Download`,
  `Ready`, `Unpack`.

## Invariants

- A download is used only if its size and SHA-256 match those pinned for the
  place it came from, so a mirror can make a download fail but never change
  what is installed. A download that grows past its size is stopped; a
  mismatch is discarded and reported, and nothing is installed. A download
  that cannot be written, as on a full disk, fails the install, which can
  then be tried again.
- **The places a program comes from are tried in order.** The next is tried
  when one cannot be reached, answers with an error, does not answer or send
  its first bytes in time, stops sending partway for longer than allowed, or
  gives a file that is not the pinned one; a slow download that keeps
  arriving goes on. A stop the person asks for, or a download that cannot be
  written, tries no other place. When every place fails, the reason names
  each and what it answered; with one place, it is that place's reason.
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
  marker naming the pinned version and the place it came from, by its address
  and its digest, so a program installed from a mirror is found where that
  mirror's archive holds it, and a new pin makes an older install read as
  missing.
- A download goes through the network the installer is handed, following the
  redirects release sites send. Node's own `fetch` serves only when none is
  handed in.

## Testing notes

Tests build real zip archives byte by byte and unpack them with the real
`tar.exe`, because refusing an entry that climbs out is that program's
behavior. The download is replaced, so no test reaches the network.

For the tests of the packages above it, `@zhiyin/toolchains/testing` offers
`fakeToolchains()`, every toolchain ready with no program to start
(ADR 0002).
