# Maintainers' guide

What the maintainers do that a contributor does not: publish releases, keep
the release and model-list keys, update the signed model list, and keep
Zhiyin's mirror copies. Building, testing and the gate are in
[tooling.md](tooling.md).

## How changes reach main

`main` takes changes only through a pull request, maintainers' included: the
repository's rules refuse a push to it, and a maintainer's bypass holds for
pull requests only. Each change is made on a branch of its own, in commits
that each make one change whole, with the gate run before each commit. The
branch is pushed, a pull request opened, and it is merged with "Rebase and
merge" once its checks have passed, so each commit lands on `main` as it was
made. A check that fails is fixed on the branch, never merged past. Tags
name commits on `main`, never a branch's.

## Releases

Releases are developer-preview alpha tags. The release workflow accepts only a
tag of the form `v0.1.0-alpha.1` that matches the desktop package version,
runs the full gate, hashes the installer, publishes the checksum in
`SHA256SUMS.txt` and in the release notes, attests build provenance when the
repository is public, and drafts the GitHub release as a prerelease, with the
installer, its block map and `latest.yml` beside it. A maintainer then signs
and publishes it (see "Releases and updates"). The installer is not
code-signed; that needs its own decision record before it is added.

Packaging builds Zhiyin's shell first with `scripts/busybox.mjs` (ADR 0029):
busybox-w32 at the pinned commit with Zhiyin's patches, and the `git` that
hands git to Zhiyin, both with the pinned w64devkit, from downloads kept only
when their SHA-256 is the pinned one. A build whose files differ from the
SHA-256 recorded in `scripts/busybox/pins.json` fails and keeps nothing.
After a deliberate change of a pin, a patch or `git-handoff.c`,
`node scripts/busybox.mjs --record` builds again and records the new hashes;
`--check <folder>` checks a packaged app's `busybox` folder, which the full
gate does. busybox-w32 is GPL-2.0: the installer carries its complete source
in `resources\busybox\source\`, busybox-w32's tarball as pinned with
Zhiyin's patches, `git-handoff.c` and the pins, and the check fails when one
is missing or the tarball's SHA-256 is not the pinned one. Its notice is in
`NOTICE` and `THIRD_PARTY_LICENSES.md`.

## Releases and updates

Installed copies update themselves (ADR 0027). They read the repository's
releases on GitHub, or Zhiyin's copy of the same files at
`https://media.zhiyinagent.app/releases/`, and run an installer only when a
release key the app ships signed it. The keys are in
`packages/feature/updates/src/release-keys.ts`, apart from the model list's, so a key
that signs prices cannot sign code.

### Publishing a release

1. On the release's branch, raise the desktop package's version and commit
   it. Run `node scripts/real-engine-record.mjs --check`: it passes when the
   record holds a passing run on the same files the real-engine tests load
   now, and otherwise names each change that counts. If it fails, run the
   real-engine tests from that commit, with nothing else changed, on a PC
   with a graphics card, with `ZHIYIN_BLENDER` naming the Blender the app
   installs and `ZHIYIN_CAD_PYTHON` the CAD environment's Python, until every
   one has passed; each run writes `scripts/real-engine-record.json`, and the
   record is committed alone. The record keeps a fingerprint of the files the
   run loaded, so the rebased merge, which gives each commit a new name,
   leaves it true. Run the release gate (`gate.ps1 -Release`), push the
   branch and open its pull request. Once its checks pass, merge it as above
   and tag the merged commit on `main` (`v0.1.0-alpha.2`, say). The release
   workflow builds the installer and leaves a draft release with the
   installer, its block map, `latest.yml` and `SHA256SUMS.txt`. A draft is
   invisible to installed copies.
2. In a terminal, from an up-to-date checkout:
   `pnpm release:publish v0.1.0-alpha.2 <path to the primary release key> --mirror <remote:bucket>`.
   It downloads the draft, checks the installer against `SHA256SUMS.txt`,
   its build attestation and `latest.yml`, asks for the key's passphrase,
   signs the installer and checks the signature as an installed copy would.
   It then uploads `Zhiyin-Setup-<version>.exe.sig` to the release, copies
   the installer, block map, signature and `latest.yml` (last) to
   `releases/` on Zhiyin's host with rclone, and publishes the release.
   `--no-mirror` leaves Zhiyin's host alone, for a release in a scratch
   repository; `--repo <owner/name>` names that repository.
3. Installed copies find it within six hours of their last look, or at
   their next start.

A published release is never signed again. To replace one, publish a newer
version: an installed copy never takes a version it already has or an
older one.

### The release keys

`pnpm release:keys <folder>` makes the primary and the backup release key, as
`pnpm model-list:keys` makes the model list's (see "The keys" under "Model
list"), and prints their public halves for `release-keys.ts`. Keep them
apart from the model list's keys. Anything that can read a release key file
and its passphrase can make every installed copy run its installer.

Until `release-keys.ts` holds the keys, the test that checks them skips; the
everyday gate allows that, and the full gate fails on it, so no release
ships a copy that would refuse every update.

If a release key is lost or may have been seen, sign the next release with
the other, ship a new pair in that release, and stop using the old one.
Copies that ship a leaked key trust it until they are updated.

### Rehearsing an update

`pnpm rehearse:update` installs and updates a real build, with nothing from
GitHub. It builds the app as a rehearsal build, packages it twice, as the
desktop version and the next, installs the first silently into a temporary
folder, and serves releases to it from a server on this computer, signed with
a key made for the run. It checks that a release with no signature, one
signed with another key, one whose installer is not the signed one and an
older signed one are refused before the installer is downloaded; that an
installer changed on the way is never installed; and that a signed newer
release is installed and started. It uninstalls the copy and removes its
data at the end. `--keep` leaves the work folder.

`--github <owner/repo>` updates the same build through that repository's
releases instead, which must be public and writable with `gh`: it makes a
draft release, checks that the installed copy does not take it, publishes
it, checks that the copy installs and starts it, and deletes the release.
Use a throwaway repository, never Zhiyin's own.

A rehearsal build hides its window, restarts into an update as soon as it is
ready, keeps its data in `%APPDATA%\Zhiyin Update Rehearsal`, installs as
`ZhiyinRehearsal` with no shortcuts, and trusts only the run's key and
server, so it never touches the Zhiyin installed on the same computer. The
build names its keys and places in the main process; the full gate's
packaged check fails on a package that carries them, so no release is built
as one.

Run it before a release that changes the updater, Electron or the installer.
It is not in the gate: it packages twice and starts installers.

## Model list

The labs' models and prices live in one file,
`packages/feature/model-client/model-list/models.json`, with its signature beside it
in `models.json.sig` (ADR 0027). Each release ships the file as it is on
`main`. Installed apps also read it from `main`, at
`https://raw.githubusercontent.com/ZhiyinAgent/Zhiyin/main/packages/feature/model-client/model-list/`,
when they start and each time the Model page opens, or, when GitHub cannot
be reached, from Zhiyin's copy at `https://media.zhiyinagent.app/model-list/`
(ADR 0027), and take it only if a key they ship signed it and its version is
higher than theirs. Git keeps both
files byte for byte (`.gitattributes`), since the signature covers the exact
bytes.

### Updating it

1. On a branch, change the entries of the labs concerned. Check each value
   against the lab's own pages, set that lab's `checked` to today and name
   the pages in its `sources`.
2. Run `pnpm format` and the gate. The model client's tests read the file
   the way an installed app does, so a value the format refuses fails there,
   with the field it is in.
3. Run `pnpm model-list:sign <path to the primary key>` in a terminal: it
   asks for the key's passphrase. It fetches `main` from GitHub; if the
   list's `version` is not above the last signed one there, it raises it by
   one and sets `published` to today, changing nothing else in the file. It
   then writes `models.json.sig`. Sign last: any change to the file
   afterwards, even of a space, needs signing again.
4. Open a pull request with both files. The gate checks that the signature
   verifies against a key in `packages/feature/model-client/src/model-list-keys.ts`.
   Merge it as any change to `main`; squash and rebase both keep the file's
   bytes.
5. Once it is on `main`, upload Zhiyin's copy from an up-to-date checkout:
   `node scripts/mirrors.mjs upload <remote:bucket> --only model-list/`
   (see "Mirrors"). It refuses files that are not those on `main`.

A list on `main` with no signature beside it was never taken by any app, so
signing counts only signed lists: the first signed list can be version 1.

Installed apps take it the next time they start or someone opens the Model
page. Raw files on GitHub may be cached for a few minutes.

A model whose requests need something the app does not yet send, such as a
new reasoning setting, cannot be added this way: it needs a release.

### The keys

`pnpm model-list:keys <folder>` makes the primary and the backup key, each an
Ed25519 key in a passphrase-encrypted PKCS#8 file named after its id, in a
folder outside the repository, and prints the public halves to paste into
`model-list-keys.ts`. Keep the folder off GitHub and out of anything synced
with it; keep the backup key, and a record of the passphrase, somewhere apart
from the primary, so losing one place loses neither. Anything that can read a
key file and its passphrase can sign a list every installed app will take.

Until `model-list-keys.ts` holds a key, the test that checks the shipped
list's signature skips. The everyday gate allows that; the full gate
(`-Full`), which runs before a release, fails on it, so no release ships an
app that would refuse every newer list.

If the primary key is lost or may have been seen, sign the next list with the
backup key, replace the primary's entry in `model-list-keys.ts` with a new
key in the next release, and stop using the old one. Installed apps keep
trusting every key they shipped with until they are updated, so a key that
may have leaked stays a risk for the versions that ship it.

### A new format

`format` is 1. Anything an app of this format would refuse, such as a new
field or a new value for an existing one, needs a new format: the release
that reads it publishes the list at a new address (`model-list/v2/`, say),
and the format 1 file stays where it is, updated alongside it while
releases that read it are in use. Each file then reads the same in every
version that reads it.

## Mirrors

Where a program, Tectonic's bundle or the model list cannot be downloaded
from its own site, the app downloads it from a mirror (ADR 0027). Some of
those mirrors are Zhiyin's own unchanged copies, on the R2 bucket behind
`media.zhiyinagent.app`: Typst's and Tectonic's release zips at
`toolchains/<id>/<version>/<file>`, Tectonic's bundle and its index at
`toolchains/tectonic-bundle/2022.0r0/`, and the model list at
`model-list/`. The others belong to Tsinghua University and npmmirror.

`node scripts/mirrors.mjs upload <remote:bucket>` makes Zhiyin's copies: it
downloads each original, keeps it only if its size and SHA-256 are the
pinned ones, and uploads it with [rclone](https://rclone.org) to the same
path, then lists the copies under `toolchains/` this build no longer reads.
It needs an rclone remote for the bucket, set up with an R2 API token that
may write it. `--only <prefix>` uploads only the paths that start with it.
Run it before a release whose pins change, and after a model list is merged;
remove a copy only once no supported release reads it.

`node scripts/mirrors.mjs check` asks every place of every pin, Zhiyin's
copies and the mirrors alike, and confirms each answers with the pinned size
and SHA-256, reading each file whole without keeping it: about 4 GB, most of
it Tectonic's bundle, read twice. `--quick` checks only the sizes the
servers state. It needs the network, so it is not a gate step; run it before
a release and when a mirror is in doubt.
