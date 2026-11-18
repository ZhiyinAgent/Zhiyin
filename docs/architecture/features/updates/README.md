# Updates

## Purpose

Keeps Zhiyin itself up to date (ADR 0027). While the app runs it looks for a
release newer than the one running, first on GitHub, then on Zhiyin's copy of
the same files. It takes a release only when a key the app ships for releases
signed its installer, downloads it in the background, and holds it ready
until the person restarts into it. It is a feature of its own because nothing
else decides what code an install runs next.

## Boundaries

- **Owns:** where releases are read and in what order; the release keys; the
  signature format and the text a key signs; ordering versions; whether
  Zhiyin looks for releases, as the person set it; the state of an update
  from looking to ready; and measuring an installer against its signature
  before it is held ready and again before it runs.
- **Does not own:** finding, downloading and starting installers, which
  electron-updater does through `UpdateSource`, implemented in the main
  process; refusing a restart while a turn runs, which the core decides,
  since it knows the turns; shutting down before the installer runs (the
  core and the main process); the Settings section and the update notice
  (renderer); signing releases, which the maintainers do with
  `scripts/release.mjs`, using the signed text from here.
- **Talks to other features only through:** the interface below.

## Public interface

- `AppUpdates({ directory, version, keys, source, network, places?, now?,
  firstLookAfter?, every?, lookLimit?, downloadSilence? })`:
  - `load()` reads whether looking is on, and whether the update started at
    the last restart did not install.
  - `start()` looks soon after, then again after each round ends; `stop()`
    ends what is under way and makes no more looks.
  - `check()` looks now and answers once the look ended, without waiting for
    a download it started.
  - `setChecks(enabled)` turns looking on or off and keeps the choice.
  - `state()` answers an `AppUpdateState` (contract); `onChanged(listener)`
    hears every change.
  - `prepareRestart()` measures the ready installer again and holds the
    update for installing; `install()`, called once Zhiyin has shut down,
    measures it once more and starts it.
- `UpdateSource`: what the main process implements with electron-updater:
  `look(place, signal)`, `download(place, release, progress, signal)` and
  `install(path)`.
- `updatePlaces` and `signatureAddress(place, release)`: where releases and
  their signatures are published, read by the release script as by the app.
- `releaseKeys`: the public keys the app ships.
- `signedText(release)`, `readReleaseSignature(text)`,
  `checkSignature(signature, offered, running, keys)`, `releaseKeysOf(keys)`
  and `wellFormed(release)`: the signature format, shared with the release
  script.
- `compareVersions(a, b)` and `isVersion(text)`.
- The types: `SignedRelease`, `ReleaseSignature`, `UpdatePlace`, `Network`,
  and `NotUsable`, the error whose message says why a release was not taken.

## Invariants

- **Nothing large is downloaded before the signature holds.** A release's
  signature file is read first; the installer is downloaded only when a
  shipped key signed exactly the version, file name, size and SHA-512
  offered.
- **Only a newer release is taken.** A signed release no newer than the
  version running, or than an update already ready, is never downloaded.
- **A signature names one installer.** A signature over other fields, for
  another version or another file, or with a field the format does not have,
  is refused.
- **What runs is what was signed.** A download is held ready only when its
  size and SHA-512 are those signed. The file is measured again when the
  person restarts and once more just before it starts; a file changed in
  between is not started.
- **A failed install is said.** The version an installer is started for is
  kept; when the next start still runs an older version, the last look says,
  once, that the update did not install.
- **Places are tried in order.** A place that cannot be reached, that does
  not say what it offers within a minute, whose download sends nothing for a
  minute, or whose
  release is refused, passes the look to the next. A refusal at one place is
  not hidden by a later place having nothing newer. When none gives a usable
  release, the look's reason names each place and what it answered.
- **Nothing is sent while looking is off.** The choice is kept, and is on
  when nothing was saved or the saved choice cannot be read. Turning it off
  ends a download under way.
- **One look at a time.** Two asked at once share one.
- **Stopping ends what is under way.** A download stopped leaves no update
  ready.

## Testing notes

The source is faked; the signatures, keys, files and their measurement are
real. Whether electron-updater finds, downloads and starts the installer as
`UpdateSource` says is tested by installing a real build and updating it
(`scripts/update-rehearsal.mjs`, `docs/maintainers.md`).
