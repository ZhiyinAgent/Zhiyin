---
status: open
effort: High
blocked-by:
---

# Prepare a supported open-source release

## Current evidence, 2026-09-15

The full gate generates the NSIS installer with its native dependencies and
passes the installed-app suite. Windows reports the generated installer as
`NotSigned`; electron-builder mentioning SignTool in its log is not a verified
signature. First install, upgrade, failed update, and release identity remain
unqualified. Private execution-evidence retention, limits, exclusions, and
deletion are now implemented and tested.

The source is licensed under Apache-2.0. The repository carries its NOTICE and
third-party attributions, including the upstream MIT terms for the transitive
`khroma@2.1.0` dependency. The legal files are included with the packaged app.
Windows CI invokes the same gate as local work, and alpha tags publish unsigned
developer previews with SHA-256 checksums and public-repository provenance.

The preview framing is deliberate: first install, restart, upgrade, failed
update, release identity, and code signing are not yet qualified as a supported
consumer distribution. GitHub Private Vulnerability Reporting also has to be
enabled in repository settings once the repository is hosted publicly.

## What and why

Qualify a supported Windows release without representing the unsigned developer
preview as a consumer-ready application.

## Done when

Installed first use, restart, upgrades, and failed updates are exercised.
Release identity and signing are verified. Unfinished advanced capabilities
remain visibly unavailable.
