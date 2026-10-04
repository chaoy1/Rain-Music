<#
.SYNOPSIS
    Deploy the pack:preview output into a self-contained preview folder inside the project.

.DESCRIPTION
    1. Copy build\win-unpacked into <projectRoot>\preview
    2. Create preview\portable so the app uses portable mode
       (src: setUserDataPath() switches userData to <exe dir>\portable\userData
        whenever a "portable" folder sits next to the executable)

    This script only reads/writes inside the project folder.
    It never touches the registry, %APPDATA%, the Start Menu or the desktop.

    NOTE: kept pure ASCII on purpose, because Windows PowerShell 5.1 reads
    .ps1 files using the ANSI code page.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File build-config\deploy-preview.ps1
#>

[CmdletBinding()]
param(
    [string]$Source,
    [string]$Target
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is not usable in param() defaults on PowerShell 5.1, resolve here
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..'))

if ([string]::IsNullOrEmpty($Source)) { $Source = Join-Path $projectRoot 'build\win-unpacked' }
if ([string]::IsNullOrEmpty($Target)) { $Target = Join-Path $projectRoot 'preview' }

$sourceFull = [System.IO.Path]::GetFullPath($Source)
$targetFull = [System.IO.Path]::GetFullPath($Target)
if (-not $sourceFull.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Source is outside the project root, refusing: $sourceFull"
}
if (-not $targetFull.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Target is outside the project root, refusing: $targetFull"
}
if ($sourceFull -eq $targetFull) {
    throw 'Source and target are the same folder, refusing'
}

if (-not (Test-Path -LiteralPath $sourceFull)) {
    throw "Build output not found: $sourceFull`nRun first: npm run pack:preview"
}

Write-Host "Source : $sourceFull"
Write-Host "Target : $targetFull"

# Remove previous output
if (Test-Path -LiteralPath $targetFull) {
    Write-Host 'Cleaning previous preview folder ...'
    Remove-Item -LiteralPath $targetFull -Recurse -Force
}
New-Item -ItemType Directory -Path $targetFull -Force | Out-Null

# Copy, skipping the electron-builder dev marker
Write-Host 'Copying build output ...'
robocopy $sourceFull $targetFull /E /NFL /NDL /NJH /NJS /NP /XF 'DevTools-Reminder.txt' | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}

# portable data dir: presence of this folder switches the app to portable mode
$portableDir = Join-Path $targetFull 'portable'
New-Item -ItemType Directory -Path $portableDir -Force | Out-Null
Set-Content -LiteralPath (Join-Path $portableDir '.keep') -Value 'portable data dir marker' -Encoding ascii

# Preset a minimal settings file so the first-run modal (licence agreement)
# does not cover the UI while reviewing visual changes.
# Only touches the preview data folder; the real app data is never touched.
$rainDatas = Join-Path $portableDir 'userData\RainDatas'
New-Item -ItemType Directory -Path $rainDatas -Force | Out-Null
$cfgPath = Join-Path $rainDatas 'config_v2.json'
$preset = '{"version":"2.12.8","setting":{"common.isAgreePact":true}}'
[System.IO.File]::WriteAllText($cfgPath, $preset, (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Preset preview settings (skip first-run modals)'

$exe = Join-Path $targetFull 'rain-music-preview.exe'
Write-Host ''
Write-Host 'Deploy done'
Write-Host "  exe      : $exe"
Write-Host "  data dir : $portableDir"
Write-Host ''
Write-Host 'Launch options:'
Write-Host "  1. double-click $exe"
Write-Host '  2. powershell -NoProfile -ExecutionPolicy Bypass -File build-config\launch-preview.ps1'
