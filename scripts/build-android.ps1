[CmdletBinding()]
param()

# Keep the old Windows entry point while sharing one verified build pipeline.
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    & pnpm.CMD android:apk
    if ($LASTEXITCODE -ne 0) { throw "APK build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
