# HUD for Claude - finishes an update once the app has quit.
#
# Written out and started by widget/update/Updater.js, detached, so it outlives
# the app it replaces. Does what install.ps1 does by hand: unpack the new
# version into place, then start it. The .zip was verified against the signed
# release before this ran.
#
# Whatever fails, the old version ends up back where it was and is started
# again, told why through HUD_UPDATE_FAILED so it can say so.
param(
  [int]$AppPid, [string]$Zip, [string]$InstallDir, [string]$Work,
  [string]$Version, [string]$Log
)
$ErrorActionPreference = 'Stop'
$ExeName = 'HUD for Claude.exe'

function Say($m) { Add-Content -Path $Log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m) }
function Relaunch($why) {
  if ($why) { $env:HUD_UPDATE_FAILED = $why }
  Start-Process -FilePath (Join-Path $InstallDir $ExeName) -WorkingDirectory $InstallDir
}
function Fail($why) { Say "FAILED: $why"; Relaunch $why; exit 1 }

Say "=== updating to $Version"

# The folder cannot be moved while the app is still running from it.
try { Wait-Process -Id $AppPid -Timeout 30 -ErrorAction SilentlyContinue } catch {}
if (Get-Process -Id $AppPid -ErrorAction SilentlyContinue) { Fail 'the app did not quit' }

$New = Join-Path $Work 'new'
$Old = Join-Path $Work 'old'
try {
  foreach ($d in @($New, $Old)) { if (Test-Path $d) { Remove-Item $d -Recurse -Force } }
  Expand-Archive -Path $Zip -DestinationPath $New -Force
} catch { Fail "could not unpack the update: $($_.Exception.Message)" }

# electron-builder puts the files at the zip's root; accept one folder down too.
$exe = Get-ChildItem -Path $New -Recurse -Filter $ExeName | Select-Object -First 1
if (-not $exe) { Fail "the update has no $ExeName" }
$Root = $exe.DirectoryName
$got = (Get-Item $exe.FullName).VersionInfo.ProductVersion
if ($got -and -not $got.StartsWith($Version)) { Fail "the update held version '$got', not $Version" }
# Files unpacked from a download carry the mark of the web; SmartScreen would stop the new exe.
Get-ChildItem -Path $Root -Recurse | Unblock-File -ErrorAction SilentlyContinue

try { Move-Item -Path $InstallDir -Destination $Old }
catch { Fail "could not move the old version aside: $($_.Exception.Message)" }
try { Move-Item -Path $Root -Destination $InstallDir }
catch {
  $why = $_.Exception.Message
  try { Move-Item -Path $Old -Destination $InstallDir }
  catch { Say "FAILED: could not restore it either; the old version is at $Old"; exit 1 }
  Fail "could not put the new version in place: $why"
}
Remove-Item $Old -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $Zip -Force -ErrorAction SilentlyContinue
Say "OK $Version"
Relaunch $null
