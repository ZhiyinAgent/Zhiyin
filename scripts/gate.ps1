<#
.SYNOPSIS
  Everything that must pass before a commit. The single definition of "green".

.DESCRIPTION
  This script is the gate for local work and CI, so those checks cannot drift.

  Default runs the fast checks. -Full adds the packaged build, which takes
  minutes and is not worth paying on every commit. -Release is -Full for a
  release: it also asks for the record of the tests that need a real Blender
  or the CAD environment, run on this commit. -Quick runs only the checks that
  read the source, in a few minutes, to run before committing.

  Those checks come first, and when one fails nothing after them runs: the
  tests, the build and the installed app take most of the time, and their
  result would not make the commit green.

  ASCII only, deliberately: Windows PowerShell 5.1 reads .ps1 as ANSI unless the
  file has a BOM, so a stray em dash here is a parse error, not a typo.

.EXAMPLE
  powershell -File scripts/gate.ps1
  powershell -File scripts/gate.ps1 -Full
  powershell -File scripts/gate.ps1 -Release
  powershell -File scripts/gate.ps1 -Quick
#>
[CmdletBinding()]
param(
    [switch]$Full,
    [switch]$Release,
    [switch]$Quick
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$failures = @()

if ($Release) { $Full = [switch]$true }

# A run before a release: a test may not skip for want of what a release must
# carry, such as the keys newer model lists are signed with.
if ($Full) { $env:ZHIYIN_RELEASE_CHECK = '1' }

function Invoke-Step {
    param([string]$Name, [scriptblock]$Body)

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    try {
        & $Body
        if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
        Write-Host "    ok" -ForegroundColor Green
    }
    catch {
        Write-Host "    FAILED: $_" -ForegroundColor Red
        $script:failures += $Name
    }
}

# Includes the feature-boundary rules. TypeScript has no private module
# boundary, so those rules are the only thing standing where a compiler would.
Invoke-Step "eslint"    { pnpm lint }

# The Python harnesses the app ships as source run only inside Blender and the
# CAD environment, which the gate does not have, so Ruff reads all of them
# here, and the Python tests after the suite run the parts that need neither.
# Ruff, at the release ruff.toml pins, run by uv; the first run downloads both.
Invoke-Step "ruff"      { pnpm lint:python }

# ESLint does not read CSS. A literal colour in a rule is a bug that only shows
# up when the ground changes underneath it, so it is caught here instead.
Invoke-Step "theme"     { node scripts/check-theme.mjs }

# Files nothing reaches, and dependencies and exports nothing imports.
Invoke-Step "knip"     { pnpm knip }

# Every dependency, not only production ones: Electron's runtime and the
# renderer's bundled libraries ship in the installer but are devDependencies,
# so `--prod` would not see them. Needs the registry, so it fails offline.
# Advisories excepted, each with its reason, are in pnpm-workspace.yaml.
Invoke-Step "audit"     { pnpm audit }

Invoke-Step "prettier"  { pnpm format:check }
Invoke-Step "typecheck" { pnpm typecheck }

# A test that needs a program and is not listed where it may skip fails the
# test run only at its end; read from the source, it is named here.
Invoke-Step "skip list" { pnpm vitest run --project repository scripts/skipped-tests.test.mjs }

# The tests that run a real Blender or the CAD environment run on a PC that
# has them and a graphics card, never in CI, and write a record of each run.
# A release needs every one of them run whole and passing on its commit.
if ($Release) {
    Invoke-Step "real engines" { node scripts/real-engine-record.mjs --check }
}

function Write-Failures {
    Write-Host ""
    if ($failures.Count -gt 0) {
        Write-Host ("FAILED: " + ($failures -join ', ')) -ForegroundColor Red
        exit 1
    }
}

if ($Quick -or $failures.Count -gt 0) {
    if ($failures.Count -gt 0 -and -not $Quick) {
        Write-Host ""
        Write-Host "Tests, build and the installed app not run: a check above failed." -ForegroundColor DarkGray
    }
    Write-Failures
    Write-Host "Source checks passed. -Quick runs no tests, build or installed app." -ForegroundColor Green
    exit 0
}

Invoke-Step "test"      { pnpm test }

# The harnesses' Python that needs neither Blender nor the CAD environment,
# by pytest on Python 3.13, run by uv; the first run downloads pytest.
Invoke-Step "python tests" { pnpm test:python }
Invoke-Step "build"     { pnpm build }

# The real app, started the way a person starts it. Needs the build above, so it
# cannot live in the fast suite. It is not optional: an installed-app contract
# that only runs before a release is a contract nobody checks. Without a build
# there is no app to start, and every test would wait out its limit.
Invoke-Step "installed" {
    if ($failures -contains "build") { throw "not run, because the build failed" }
    pnpm test:installed
}

if ($Full) {
    Invoke-Step "package" { pnpm package }
    Invoke-Step "packaged" { node scripts/check-packaged.mjs }
    # The executable itself, fuses and all, opened on a saved conversation.
    Invoke-Step "packaged launch" {
        $env:ZHIYIN_PACKAGED_APP = (Resolve-Path "apps/desktop/release/win-unpacked/Zhiyin.exe").Path
        try { pnpm vitest run --project installed apps/desktop/installed/packaged-app.test.ts }
        finally { Remove-Item Env:ZHIYIN_PACKAGED_APP }
    }
    # Every language is checked with nothing downloaded only if the installer
    # carries every dictionary, unchanged (ADR 0027).
    Invoke-Step "packaged dictionaries" { node scripts/dictionaries.mjs --check apps/desktop/release/win-unpacked/resources/dictionaries }
    # Documents are drawn in a process whose script, pdf.js and canvas load from
    # inside app.asar once packed, which the build folder never exercises. The
    # packaged exe refuses Playwright's inspector switch, so the archive runs
    # under the development Electron binary (ADR 0019).
    Invoke-Step "packed documents" {
        $env:ZHIYIN_APP_ARCHIVE = (Resolve-Path "apps/desktop/release/win-unpacked/resources/app.asar").Path
        try { pnpm vitest run --project installed apps/desktop/installed/documents.test.ts }
        finally { Remove-Item Env:ZHIYIN_APP_ARCHIVE }
    }
}

Write-Failures
Write-Host "All checks passed." -ForegroundColor Green
if (-not $Full) {
    Write-Host "(packaging not checked - run with -Full before a release)" -ForegroundColor DarkGray
}
exit 0
