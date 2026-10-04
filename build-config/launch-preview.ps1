<#
.SYNOPSIS
    Launch the in-project preview build, fully isolated.

.DESCRIPTION
    Passes --user-data-dir pointing at preview\portable\userData.

    Why this switch is needed:
      Electron/Chromium resolves and CREATES the default userData directory
      (%APPDATA%\rain-music-preview) during its own early start-up, before the
      main script gets a chance to call app.setPath(). The result was an empty
      leftover directory outside the project.
      --user-data-dir is a Chromium-recognised switch, so it is accepted
      (unlike a custom switch, which Electron rejects with "bad option"),
      and it stops that directory from ever being created.

    Double-clicking preview\rain-music-preview.exe still works and is fully
    functional (data stays in preview\portable\userData via the build-time
    redirect); only an empty %APPDATA%\rain-music-preview folder may be left
    behind in that case.

    NOTE: kept pure ASCII on purpose, because Windows PowerShell 5.1 reads
    .ps1 files using the ANSI code page.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File build-config\launch-preview.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is not usable in param() defaults on PowerShell 5.1, resolve here
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..'))

$exe = Join-Path $projectRoot 'preview\rain-music-preview.exe'
$userDataDir = Join-Path $projectRoot 'preview\portable\userData'

if (-not (Test-Path -LiteralPath $exe)) {
    throw "Preview exe not found: $exe`nRun first: npm run pack:preview, then build-config\deploy-preview.ps1"
}

Write-Host "Launching: $exe" -ForegroundColor Green
Write-Host "user-data-dir: $userDataDir" -ForegroundColor DarkGray
Start-Process -FilePath $exe -ArgumentList "--user-data-dir=`"$userDataDir`""
