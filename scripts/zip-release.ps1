# Build and package the extension into a ZIP suitable for the Chrome Web Store.
# The archive contains the *contents* of dist/ (manifest.json at the root),
# as required by the Chrome Web Store.
#
# Usage: .\scripts\zip-release.ps1 [-Version <string>]
#   -Version  optional version label used in the output filename
#             (defaults to the version in manifest.json)

[CmdletBinding()]
param(
    [string]$Version
)

$ErrorActionPreference = "Stop"

$RootDir  = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DistDir  = Join-Path $RootDir "dist"
$OutDir   = Join-Path $RootDir "release"

if (-not (Test-Path $DistDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
else { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

# Build first so dist/ is up to date.
Write-Host "Building extension..."
Push-Location $RootDir
try {
    npm run build
} finally {
    Pop-Location
}

$ManifestPath = Join-Path $DistDir "manifest.json"
if (-not (Test-Path $ManifestPath)) {
    Write-Error "dist/manifest.json not found. Build may have failed."
    exit 1
}

# Determine version from manifest.json (or from -Version).
if (-not $Version) {
    $Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
    $Version  = $Manifest.version
    if (-not $Version) { $Version = "0.0.0" }
}

$ZipName = "llm-page-translator-$Version.zip"
$ZipPath = Join-Path $OutDir $ZipName

# Use Compress-Archive, zipping the contents of dist/ (so manifest.json is at
# the archive root) rather than the dist folder itself.
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path (Join-Path $DistDir "*") -DestinationPath $ZipPath -Force

Write-Host "Created release archive: $ZipPath"
