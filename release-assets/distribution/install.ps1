#Requires -Version 5.1
<#
  HUD for Claude - Windows installer
  Installs to %LOCALAPPDATA%\Programs (no administrator rights needed).
  Finds the .zip sitting next to it, so it needs no edit when the version changes.
#>
$ErrorActionPreference = 'Stop'
$AppName   = 'HUD for Claude'
$Here      = Split-Path -Parent $MyInvocation.MyCommand.Definition
$InstallTo = Join-Path $env:LOCALAPPDATA "Programs\$AppName"

function Ok($m)   { Write-Host "  [OK] $m"   -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]  $m"   -ForegroundColor Yellow }
function Info($m) { Write-Host "       $m"   -ForegroundColor DarkGray }
function Step($m) { Write-Host ""; Write-Host $m -ForegroundColor White }

Step "1/4  检查前提"
$credDir  = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$credFile = Join-Path $credDir '.credentials.json'
if (Test-Path $credFile) {
  Ok "找到 Claude Code 凭证"
} else {
  Warn "没找到 Claude Code 凭证"
  Info "位置应为: $credFile"
  Info "配额那两条会是空的。请先安装 Claude Code 并登录一次:"
  Info "https://claude.com/claude-code"
}
$projDir = Join-Path $credDir 'projects'
$count = 0
if (Test-Path $projDir) {
  $count = @(Get-ChildItem $projDir -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue).Count
}
if ($count -gt 0) { Ok "找到 $count 份本地使用记录" }
else { Warn "还没有本地使用记录 - 用量统计会是 0，用一阵 Claude Code 就有了" }

Step "2/4  安装到 $InstallTo"
$zip = Get-ChildItem -Path $Here -Filter *.zip | Select-Object -First 1
if (-not $zip) { Write-Host "  [X] 找不到 .zip - 请确保它和 install.ps1 在同一个文件夹" -ForegroundColor Red; exit 1 }

Get-Process -Name 'HUD for Claude' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800
if (Test-Path $InstallTo) { Info "发现旧版本，先移除"; Remove-Item $InstallTo -Recurse -Force }
New-Item -ItemType Directory -Path $InstallTo -Force | Out-Null

# Unblock first: a zip downloaded from the internet carries a Zone.Identifier
# stream that propagates to every extracted file and trips SmartScreen.
Unblock-File -Path $zip.FullName -ErrorAction SilentlyContinue
Expand-Archive -Path $zip.FullName -DestinationPath $InstallTo -Force
Get-ChildItem $InstallTo -Recurse | Unblock-File -ErrorAction SilentlyContinue

$exe = Join-Path $InstallTo "$AppName.exe"
if (-not (Test-Path $exe)) {
  $found = Get-ChildItem $InstallTo -Recurse -Filter '*.exe' | Select-Object -First 1
  if ($found) { $exe = $found.FullName } else {
    Write-Host "  [X] 解压后找不到 .exe" -ForegroundColor Red; exit 1 }
}
Ok "已安装"

Step "3/4  建立快捷方式"
$ws = New-Object -ComObject WScript.Shell
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName.lnk"
$sc = $ws.CreateShortcut($startMenu)
$sc.TargetPath = $exe; $sc.WorkingDirectory = $InstallTo; $sc.Description = 'Claude usage HUD'
$sc.Save()
Ok "开始菜单"
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"
$sc2 = $ws.CreateShortcut($desktop)
$sc2.TargetPath = $exe; $sc2.WorkingDirectory = $InstallTo; $sc2.Description = 'Claude usage HUD'
$sc2.Save()
Ok "桌面"

Step "4/4  完成"
Ok "现在可以打开了"
Write-Host ""
Info "首次启动时 Windows SmartScreen 可能会拦一次 - 这是未签名程序的正常拦截。"
Info "点「更多信息」(More info) -> 「仍要运行」(Run anyway)。只需一次。"
Write-Host ""
$ans = Read-Host "       现在打开它? [Y/n]"
if ($ans -eq '' -or $ans -match '^[Yy]') {
  Start-Process -FilePath $exe
  Info "已启动。"
} else {
  Info "稍后可从开始菜单或桌面快捷方式打开。"
}
Write-Host ""
