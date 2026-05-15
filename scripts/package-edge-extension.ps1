param(
  [string]$Version = "",
  [string]$RawBranch = "main"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..")
$ExtDir = Join-Path $RootDir "web-extension"
$DistDir = Join-Path $RootDir "dist"

if ([string]::IsNullOrWhiteSpace($Version)) {
  $ExtPkgPath = Join-Path $ExtDir "package.json"
  $ExtPkg = Get-Content -Path $ExtPkgPath -Raw | ConvertFrom-Json
  $CurrentVersion = [string]$ExtPkg.version
  Write-Host "Please input extension version (example: 1.1.1)."
  $InputVersion = Read-Host "Extension version [$CurrentVersion]"
  if ([string]::IsNullOrWhiteSpace($InputVersion)) {
    $Version = $CurrentVersion
  } else {
    $Version = $InputVersion.Trim()
  }
}

$ZipName = "ainote-web-extension-v$Version-edge.zip"
$OutFile = Join-Path $DistDir $ZipName
$RawUrl = "https://raw.githubusercontent.com/BlueBlueKitty/zotero-ainote/$RawBranch/dist/$ZipName"
$ReadmeCn = Join-Path $RootDir "README.md"
$ReadmeEn = Join-Path $RootDir "doc/README_en-US.md"
$ManifestPath = Join-Path $ExtDir "manifest.json"
$VersionInfoPath = Join-Path $RootDir "web-version.json"

$ExtPkgObj = Get-Content -Path (Join-Path $ExtDir "package.json") -Raw | ConvertFrom-Json
$ExtPkgObj.version = $Version
($ExtPkgObj | ConvertTo-Json -Depth 100) + "`n" | Set-Content -Path (Join-Path $ExtDir "package.json")

$ManifestObj = Get-Content -Path $ManifestPath -Raw | ConvertFrom-Json
$ManifestObj.version = $Version
($ManifestObj | ConvertTo-Json -Depth 100) + "`n" | Set-Content -Path $ManifestPath

if (Test-Path $VersionInfoPath) {
  $VersionInfoObj = Get-Content -Path $VersionInfoPath -Raw | ConvertFrom-Json
} else {
  $VersionInfoObj = [pscustomobject]@{}
}
if ($null -eq $VersionInfoObj.extension) {
  $VersionInfoObj | Add-Member -NotePropertyName extension -NotePropertyValue ([pscustomobject]@{}) -Force
}
$VersionInfoObj.extension.latestVersion = $Version
if ($VersionInfoObj.PSObject.Properties.Name -contains "extensionDownloadUrl") {
  $VersionInfoObj.extensionDownloadUrl = $RawUrl
} else {
  $VersionInfoObj | Add-Member -NotePropertyName extensionDownloadUrl -NotePropertyValue $RawUrl -Force
}
($VersionInfoObj | ConvertTo-Json -Depth 100) + "`n" | Set-Content -Path $VersionInfoPath

New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
if (Test-Path $OutFile) {
  Remove-Item $OutFile -Force
}

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ainote-web-extension-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

try {
  Copy-Item -Path (Join-Path $ExtDir "*") -Destination $TempDir -Recurse -Force

  $ExcludePaths = @(
    ".DS_Store",
    "tsconfig.json",
    "chrome.d.ts"
  )
  foreach ($item in $ExcludePaths) {
    Get-ChildItem -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq $item } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  foreach ($dirName in @("node_modules", "store-assets")) {
    Get-ChildItem -Path $TempDir -Recurse -Force -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq $dirName } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }

  Compress-Archive -Path (Join-Path $TempDir "*") -DestinationPath $OutFile -Force
} finally {
  if (Test-Path $TempDir) {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$pattern = 'https://raw\.githubusercontent\.com/BlueBlueKitty/zotero-ainote/.*/dist/ainote-web-extension-v[0-9A-Za-z._-]+-edge\.zip'
foreach ($readme in @($ReadmeCn, $ReadmeEn)) {
  $content = Get-Content -Path $readme -Raw
  $updated = [System.Text.RegularExpressions.Regex]::Replace($content, $pattern, $RawUrl)
  Set-Content -Path $readme -Value $updated -NoNewline
}

Write-Host "Packaged: $OutFile"
Write-Host "Updated raw link: $RawUrl"
Write-Host "Updated version files: web-extension/package.json, web-extension/manifest.json, web-version.json"
