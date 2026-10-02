# Shared by install.ps1 and uninstall.ps1 (dot-sourced).
# Windows PowerShell 5.1 compatible; ASCII only.
#
# One home: app is replaceable; Prints, extensions and state persist.

$ErrorActionPreference = 'Stop'

$SaamHome = 'C:\SAAM'
if ($env:SAAM_DATA -and [IO.Path]::GetFullPath($env:SAAM_DATA).TrimEnd('\') -ine (Join-Path $env:LOCALAPPDATA 'SAAM')) { $SaamHome = [IO.Path]::GetFullPath($env:SAAM_DATA) }
if ($env:SAAM_INSTALL_TEST_ROOT) { $SaamHome = [IO.Path]::GetFullPath($env:SAAM_INSTALL_TEST_ROOT) }
$SaamRoot = Join-Path $SaamHome 'app'
$LegacyData = Join-Path $env:LOCALAPPDATA 'SAAM'
$LegacyApp = Join-Path $env:LOCALAPPDATA 'Programs\SAAM'
$StartMenu = [Environment]::GetFolderPath('Programs')
$Desktop = [Environment]::GetFolderPath('Desktop')
$StartMenuLink = Join-Path $StartMenu 'SAAM.lnk'
$DesktopLink = Join-Path $Desktop 'SAAM.lnk'
$ConsoleLink = Join-Path $StartMenu 'SAAM (with console).lnk'
$UninstallLink = Join-Path $StartMenu 'Uninstall SAAM.lnk'
$Shortcuts = @($StartMenuLink, $DesktopLink, $ConsoleLink, $UninstallLink)

function Get-SaamDataFolder {
  return $SaamHome
}

# Set by install.ps1 when SAAM updates itself: no one watches that window, so
# progress and failures also go to <data>\logs\update.log.
$UpdateLog = $null
function Write-Log([string]$Message) {
  if ($UpdateLog) { Add-Content -LiteralPath $UpdateLog -Value ((Get-Date).ToString('o') + ' ' + $Message) -Encoding UTF8 }
}

function Stop-WithMessage([string]$Message) {
  Write-Log $Message
  Write-Host ''
  Write-Host $Message -ForegroundColor Red
  exit 1
}

# True while SAAM runs: the data folder's instance record names a live node
# process, or a node process runs from the installation folder.
function Test-SaamRunning {
  foreach ($record in @((Join-Path $SaamHome 'state\instance.json'), (Join-Path $LegacyData 'instance.json'))) {
  if (Test-Path -LiteralPath $record) {
    try {
      $instance = Get-Content -LiteralPath $record -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($instance.pid) {
        $process = Get-Process -Id ([int]$instance.pid) -ErrorAction SilentlyContinue
        if ($process -and $process.ProcessName -eq 'node') { return $true }
      }
    } catch { }
  } }
  $fromInstall = Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and ($_.Path.StartsWith($SaamRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or $_.Path.StartsWith($LegacyApp + '\', [StringComparison]::OrdinalIgnoreCase)) }
  return [bool]$fromInstall
}

function Assert-SaamStopped([string]$Action) {
  if (Test-SaamRunning) {
    Stop-WithMessage "SAAM is running. Choose Quit from the SAAM tray icon, then $Action again."
  }
}

# Removes a folder, including paths longer than 260 characters that
# Remove-Item cannot reach in Windows PowerShell 5.1: robocopy mirrors an
# empty folder over it first.
function Remove-Folder([string]$Path) {
  $resolved = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $boundary = [IO.Path]::GetFullPath($SaamHome).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing removal outside the SAAM home: $resolved" }
  if (-not (Test-Path -LiteralPath $Path)) { return }
  if ((Get-Item -LiteralPath $resolved -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing removal through a reparse point: $resolved" }
  $empty = Join-Path ([IO.Path]::GetTempPath()) ('saam-empty-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $empty | Out-Null
  try { robocopy $empty $Path /MIR /XJ /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null }
  finally { Remove-Item -LiteralPath $empty -Force }
  Remove-Item -LiteralPath $Path -Recurse -Force
}
