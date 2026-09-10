[CmdletBinding()]
param()

# Stop before publishing if any step produces an incomplete or incorrectly identified APK.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

# Use the project's pinned local toolchain; JAVA_HOME only affects this process tree.
$javaHome = Join-Path $env:LOCALAPPDATA 'GoldenAbacus\jdk-21\jdk-21.0.12.1+1'
$java = Join-Path $javaHome 'bin\java.exe'
$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$debugKey = Join-Path $env:USERPROFILE '.android\debug.keystore'

# Package id and signer digest must both match the currently installed app.
$expectedSigner = '5c7ad0becc97ddd99acefdc14f07ec510e903c053d20330b5b81cca7938ad434'
$expectedAppId = 'com.goldenabacus.app'

if (-not (Test-Path -LiteralPath $java)) { throw "JDK 21 not found at $javaHome" }
if (-not (Test-Path -LiteralPath $sdkRoot)) { throw "Android SDK not found at $sdkRoot" }
if (-not (Test-Path -LiteralPath $debugKey)) { throw "Debug signing key not found at $debugKey" }

$env:JAVA_HOME = $javaHome
$env:Path = "$(Join-Path $javaHome 'bin');$env:Path"

# Native commands do not throw automatically, so check each exit code explicitly.
function Assert-Success([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE" }
}

Push-Location $projectRoot
try {
  # Release pipeline: tests -> web build -> native sync -> debug APK.
  & pnpm.CMD test
  Assert-Success 'Tests'
  & pnpm.CMD build
  Assert-Success 'Web build'
  & (Join-Path $projectRoot 'node_modules\.bin\cap.CMD') sync android
  Assert-Success 'Capacitor sync'

  Push-Location (Join-Path $projectRoot 'android')
  try {
    & .\gradlew.bat assembleDebug
    Assert-Success 'Android build'
  } finally {
    Pop-Location
  }

  # Gradle metadata is authoritative for the final package id and version.
  $apk = Join-Path $projectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
  $metadataPath = Join-Path $projectRoot 'android\app\build\outputs\apk\debug\output-metadata.json'
  if (-not (Test-Path -LiteralPath $apk)) { throw "APK not found at $apk" }
  $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  $element = $metadata.elements[0]
  if ($metadata.applicationId -ne $expectedAppId) { throw "Unexpected applicationId: $($metadata.applicationId)" }

  # Verify the certificate with the newest installed build-tools version.
  $signerTool = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Filter 'apksigner.bat' -Recurse |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $signerTool) { throw 'apksigner.bat not found in Android SDK build-tools' }
  $signature = & $signerTool verify --print-certs $apk
  Assert-Success 'APK signature verification'
  $signer = [regex]::Match(($signature -join "`n"), 'SHA-256 digest:\s*([0-9a-fA-F]+)').Groups[1].Value.ToLowerInvariant()
  if ($signer -ne $expectedSigner) { throw "Unexpected APK signer: $signer" }

  # Copy the versioned artifact and hash it only after every identity check passes.
  $releaseDir = Join-Path $projectRoot 'releases'
  New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
  $releaseApk = Join-Path $releaseDir "golden-abacus-$($element.versionName)-vc$($element.versionCode)-debug.apk"
  Copy-Item -LiteralPath $apk -Destination $releaseApk -Force
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $hash = [System.BitConverter]::ToString($sha256.ComputeHash([System.IO.File]::ReadAllBytes($releaseApk))).Replace('-', '')
  $sha256.Dispose()

  Write-Host "APK: $releaseApk"
  Write-Host "Package: $($metadata.applicationId)"
  Write-Host "Version: $($element.versionName) ($($element.versionCode))"
  Write-Host "Signer SHA-256: $signer"
  Write-Host "File SHA-256: $hash"
} finally {
  Pop-Location
}
