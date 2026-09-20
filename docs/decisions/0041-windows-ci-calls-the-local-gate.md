# 0041. Windows CI calls the local gate

Status: accepted

## Context

ADR 0004 chose Windows as the only supported platform and made a local script
the single definition of a green repository. It deferred CI because there was
not yet a release surface worth protecting. The repository now has an
open-source license, contribution policy, installed-application regressions,
and an unsigned developer-preview release path. A local-only hook is no longer
an adequate merge boundary.

**Assumptions this decision depends on** (revisit it if any changes):

- Windows remains the only supported build and runtime platform.
- The repository gate remains useful locally and must not diverge from CI.
- Pull-request checks do not receive provider credentials.
- Packaged alpha artifacts are convenience builds, not a supported automatic
  update channel.

## Decision

Pull requests and pushes to the main branch run on GitHub's Windows runner. CI
installs the locked dependencies and Electron runtime, then invokes the ordinary
repository gate. It does not restate lint, typecheck, test, or build commands.

Alpha tags have a separate release workflow because packaging and publication
are release effects, not merge checks. The workflow accepts only an alpha tag
matching the desktop package version, invokes the same gate with `-Full`, hashes
the installer, publishes the checksum in a file and the release notes, and marks
the GitHub release as a prerelease rather than latest. A public repository also
receives GitHub build-provenance attestation for the installer.

The installer remains unsigned. Source setup, the unsigned boundary, external
service requirements, and missing update channel are stated wherever a person
encounters the preview.

Rejected alternatives: spelling out the individual checks in workflow YAML,
which would create a second gate; packaging every pull request, which adds no
release evidence beyond the full gate; and presenting an unsigned installer as
a stable release, which hides the trust decision from the person running it.

## Consequences

- The local hook and the server-side merge check exercise the same contract.
- Windows-only failures are tested on the supported platform; macOS and Linux
  remain explicitly unqualified.
- A contributor can reproduce CI without GitHub-specific scripts.
- Live provider behavior remains separate evidence because secrets are not
  placed in pull-request workflows.
- Publishing an alpha requires a version change and matching tag, so an
  accidental broad tag cannot create a release.
- Code signing, updater design, and install/upgrade qualification remain future
  release decisions rather than implied capabilities of the alpha workflow.
