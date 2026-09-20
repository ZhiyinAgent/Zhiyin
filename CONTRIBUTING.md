# Contributing to Zhiyin

Zhiyin is a Windows-only Electron and TypeScript workspace managed by pnpm. Read
the [working agreement](docs/working-agreement.md), current
[architecture decisions](docs/decisions/), and the owning feature's README
before changing a feature boundary.

## Local setup

Install these prerequisites:

- Windows
- Git
- Node.js 22 or newer
- Edge or Chrome for browser and visual-regression coverage

The repository pins pnpm 11.25.0 through the `packageManager` field. On a fresh
clone, run:

```powershell
corepack enable
pnpm install
pnpm --filter desktop install:electron
pnpm dev
```

The filtered `install:electron` script is a required clean-install step. It runs
Electron's installer from the desktop workspace that declares the package.
Electron 44 ships its runtime through that command instead of a package
postinstall script, so omitting it leaves the JavaScript package present but the
Electron executable absent. Run it again after deleting `node_modules`; an
ordinary install does not need to replace an existing runtime.

CI uses `pnpm install --frozen-lockfile`. Use the same command when reproducing a
CI install. Change `pnpm-lock.yaml` only when a dependency change is intentional.

## Making a change

- Keep each feature self-contained and use only its documented public interface.
- For new behavior, add a failing behavior test before the implementation.
- Do not weaken a working test to accept broken behavior.
- Update the owning feature invariant and named regression with a runtime fix.
- Record unfinished work as one checkable file under `tasks/`.
- Never commit credentials, provider responses containing private data, local
  evaluation evidence, build output, or packaged installers.

## Required pull-request gate

Every pull request must pass this command without regressions:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gate.ps1
```

Do not reproduce selected checks in a pull request and call it equivalent. The
script is the single source of truth and currently covers:

- ESLint architecture and code rules
- theme and formatting checks
- strict workspace typechecking through `tsc --noEmit`
- unit, repository, renderer, and real-browser visual tests
- the production build
- installed-app regressions

Run the release gate before proposing an alpha tag:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gate.ps1 -Full
```

The full form adds installer packaging. Live provider checks require an external
credential and network access and are deliberately separate from pull-request
CI; never add a contributor's credential to a workflow.

## Pull requests

Describe the observable change, its evidence, and any limit that remains. Keep
commits small enough that the test and behavior move together. A pull request is
ready for review when the gate passes, relevant documentation agrees with the
production path, and no known follow-up exists only in a comment or description.

Unless explicitly stated otherwise, an intentional contribution submitted for
inclusion is licensed under Apache-2.0 as described by section 5 of the project
license.
