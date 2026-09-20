# Zhiyin

Zhiyin is a general-purpose Windows desktop agent for nontechnical people, with
inspectable actions and manageable capabilities.

The current release line is an **unsigned developer preview**. It is suitable
for source review, local development, and controlled evaluation. It is not a
consumer-ready application and has no automatic update channel.

Implemented production paths include conversations through a configured model,
typed tools inside a selected workspace, reviewed file changes and shell work,
an owned headless browser with a visible preview, Streamable HTTP MCP servers
with optional bearer credentials, bundled skills, durable history and file
rewind, action evidence, and provider usage views.

Interactive MCP OAuth and project capability import are not implemented and are
not presented as available capabilities. Specialist execution is implemented,
but has not yet been shown to improve held-out outcomes over the single-agent
path. See the [roadmap](docs/roadmap-proposal.md) and [open
tasks](tasks/README.md) for the remaining product work.

## Run from source

Zhiyin currently supports Windows only. Install Git, Node.js 22 or newer, and a
local Edge or Chrome browser. Then run:

```powershell
corepack enable
pnpm install
pnpm --filter desktop install:electron
pnpm dev
```

`pnpm --filter desktop install:electron` is required after a clean install or
whenever `node_modules` has been removed. The desktop-owned script runs
Electron's installer from the workspace that declares the package. Electron 44
does not install its runtime binary through `pnpm install`; an ordinary
dependency update can reuse an existing runtime.

Configure the provider key in Settings. Select a folder to make it available to
workspace tools. The installed app has no implicit folder access.

More setup and contribution details are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Verification

Every pull request must pass the repository gate without regressions:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gate.ps1
```

Before a tagged preview, run the full gate, which also builds the NSIS installer:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gate.ps1 -Full
```

The gate is the single definition of green for local work and GitHub Actions. It
includes lint, formatting and theme checks, strict TypeScript checking with no
emit, unit and repository tests, real-browser visual regressions, the production
build, and installed-app regressions.

## Developer-preview releases

GitHub prereleases tagged like `v0.1.0-alpha.1` contain an unsigned NSIS
installer as a convenience. The release workflow accepts only an alpha tag that
matches the desktop package version, runs the full gate, publishes
`SHA256SUMS.txt`, places the SHA-256 value in the release notes, and creates a
build-provenance attestation when the repository is public.

Windows may show a Microsoft Defender SmartScreen warning for the unsigned
installer. Verify the checksum before running it. Building the tagged source is
the most inspectable installation path.

## Project guide

- [Product roadmap](docs/roadmap-proposal.md)
- [Architecture decisions](docs/decisions/)
- [Feature boundaries](docs/architecture/features/)
- [Product behavior](docs/product-behavior/)
- [Testing philosophy](docs/testing-philosophy.md)
- [Tooling and gate](docs/tooling.md)
- [Security policy](SECURITY.md)
- [Third-party licenses](THIRD_PARTY_LICENSES.md)

## License

Copyright 2026 Bastien HOTTELET. Licensed under the
[Apache License 2.0](LICENSE). Required attributions are recorded in
[NOTICE](NOTICE) and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
