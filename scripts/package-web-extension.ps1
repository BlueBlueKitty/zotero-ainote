param([string]$Version = "")

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDirectory = Resolve-Path (Join-Path $scriptDirectory "..")
$extensionDirectory = Join-Path $rootDirectory "web-extension"
$manifest = Get-Content -LiteralPath (Join-Path $extensionDirectory "manifest.json") -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $extensionDirectory "package.json") -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = [string]$manifest.version
}
if ($Version -ne [string]$manifest.version -or $Version -ne [string]$package.version) {
  throw "Requested, manifest, and package versions must match."
}

& npm --prefix $extensionDirectory run check
if ($LASTEXITCODE -ne 0) { throw "Extension check failed." }

$distDirectory = Join-Path $rootDirectory "dist"
$outputFile = Join-Path $distDirectory "ainote-web-extension-v$Version.zip"
New-Item -ItemType Directory -Path $distDirectory -Force | Out-Null
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("ainote-web-extension-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

try {
  foreach ($name in @("_locales", "icons")) {
    Copy-Item -LiteralPath (Join-Path $extensionDirectory $name) -Destination $temporaryDirectory -Recurse
  }
  foreach ($name in @("background.js", "bridge-client.js", "compat.js", "content.js", "debug.js", "manifest.json", "options.html", "options.js", "page-contract.js", "result-extractor.js", "storage.js")) {
    Copy-Item -LiteralPath (Join-Path $extensionDirectory $name) -Destination $temporaryDirectory
  }
  if (Test-Path -LiteralPath $outputFile) {
    Remove-Item -LiteralPath $outputFile -Force
  }
  Compress-Archive -Path (Join-Path $temporaryDirectory "*") -DestinationPath $outputFile
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}

Write-Host "Packaged Chrome/Edge extension: $outputFile"
