<#
.SYNOPSIS
  Everything that must pass before a commit. The single definition of "green".

.DESCRIPTION
  This script is the gate for local work and CI, so those checks cannot drift.

  Default runs the fast checks. -Full adds the packaged build, which takes
  minutes and is not worth paying on every commit.

  ASCII only, deliberately: Windows PowerShell 5.1 reads .ps1 as ANSI unless the
  file has a BOM, so a stray em dash here is a parse error, not a typo.

.EXAMPLE
  powershell -File scripts/gate.ps1
  powershell -File scripts/gate.ps1 -Full
#>
[CmdletBinding()]
param(
    [switch]$Full
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$failures = @()

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

# ESLint does not read CSS. A literal colour in a rule is a bug that only shows
# up when the ground changes underneath it, so it is caught here instead.
Invoke-Step "theme"     { node scripts/check-theme.mjs }

# Files nothing reaches and dependencies nothing imports. Unused exports are
# not part of this step yet; see tasks/unused-exports.md.
Invoke-Step "knip"     { pnpm knip }

Invoke-Step "prettier"  { pnpm format:check }
Invoke-Step "typecheck" { pnpm typecheck }
Invoke-Step "test"      { pnpm test }
Invoke-Step "build"     { pnpm build }

# The real app, started the way a person starts it. Needs the build above, so it
# cannot live in the fast suite. It is not optional: an installed-app contract
# that only runs before a release is a contract nobody checks.
Invoke-Step "installed" { pnpm test:installed }

if ($Full) {
    Invoke-Step "package" { pnpm package }
}

Write-Host ""
if ($failures.Count -gt 0) {
    Write-Host ("FAILED: " + ($failures -join ', ')) -ForegroundColor Red
    exit 1
}

Write-Host "All checks passed." -ForegroundColor Green
if (-not $Full) {
    Write-Host "(packaging not checked - run with -Full before a release)" -ForegroundColor DarkGray
}
exit 0
