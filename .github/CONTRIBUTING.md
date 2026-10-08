# Contributing to Zhiyin

Zhiyin is a Windows Electron app written in TypeScript: a pnpm workspace with
one package per feature and a React window. Before changing a feature, read
its README under [docs/architecture/features](../docs/architecture/features/);
before changing a boundary, read the
[architecture decisions](../docs/decisions/) and the
[working agreement](../docs/working-agreement.md). Coding agents also read
[AGENTS.md](../AGENTS.md). Everyone taking part follows the
[code of conduct](CODE_OF_CONDUCT.md).

## Local setup

You need:

- Windows
- Git for Windows
- Node.js 22 or newer
- Edge or Chrome, for browser work and the real-browser tests

The repository pins pnpm 11.25.0 through the `packageManager` field. On a
fresh clone, run:

```powershell
corepack enable
pnpm install
pnpm --filter desktop install:electron
pnpm dev
```

Electron 44 installs its runtime through its own installer module, not a
postinstall script, so `pnpm install` leaves the Electron package without its
executable. The filtered `install:electron` script runs that installer from
the desktop package that declares Electron. Run it again after deleting
`node_modules`; an ordinary install keeps the runtime already there.

Until you choose a folder, `pnpm dev` works in the repository itself, or in
`ZHIYIN_WORKSPACE` when that is set. Save the OpenRouter key on the Model page,
or set `OPENROUTER_API_KEY`, which the Model page then shows as the key's
source.

CI installs with `pnpm install --frozen-lockfile`; use the same command to
reproduce a CI install. Change `pnpm-lock.yaml` only with an intended
dependency change.

## Making a change

- Keep each feature in its own package, reached only through the public
  interface in its README. New features start from
  [the template](../docs/architecture/features/_template/README.md).
- For new behavior, write a failing behavior test first.
- Never weaken a working test to accept broken behavior.
- With a runtime fix, update the owning feature's invariant and add a
  regression test that reproduces the defect.
- Record unfinished work you find as a GitHub issue.
- Never commit credentials, provider responses with private data, build
  output or installers.

## The gate

Every pull request must pass the gate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gate.ps1
```

The script is the one definition of green, for local work and GitHub
Actions, so run it rather than a selection of its checks. It covers:

- ESLint, including the rules that hold feature boundaries
- theme and formatting checks
- unused files, exports and dependencies (knip), and the dependency audit
- strict type checking with `tsc --noEmit`
- unit, repository, window and real-browser tests
- the production build
- tests against the built app

The dependency audit and the first build reach the network: the build fetches
the spelling dictionaries and checks them against their SHA-256.

Before proposing an alpha tag, run the full gate, which also builds the
installer and checks what it packs:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gate.ps1 -Full
```

A live check against the model provider runs only when asked, since it spends
credit on a real account:

```powershell
$env:ZHIYIN_SMOKE = "1"; pnpm exec vitest run --project packages packages/core/test/app/live-smoke.test.ts
```

It needs `OPENROUTER_API_KEY`. Pull-request CI holds no credentials; never
add one to a workflow.

## Pull requests

Describe the observable change, the evidence for it, and any limit that
remains. Keep commits small enough that a test and the behavior it covers
move together. A pull request is ready for review when the gate passes, the
documentation agrees with the code, and every known follow-up is an issue
rather than a comment.

Unless stated otherwise, a contribution intentionally submitted for inclusion
is licensed under Apache-2.0, as section 5 of the license describes.
