# Shared by install.ps1 and uninstall.ps1 (dot-sourced).
# Windows PowerShell 5.1 compatible; ASCII only.
#
# One home: app is replaceable; local data and state persist.

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

# install.ps1 reports each stage with its output so far (its transcript;
# diagnostics scrub paths, URLs and credentials) through the first of these
# SAAM programs that has packaging\installer-report.mjs.
$DiagnosticProgram = $null
$FirstRun = $false
$Transcript = $null
function Start-InstallerTranscript {
  $script:Transcript = Join-Path ([IO.Path]::GetTempPath()) ('saam-install-' + [guid]::NewGuid().ToString('N') + '.txt')
  Start-Transcript -LiteralPath $script:Transcript | Out-Null
}
function Stop-InstallerTranscript {
  if (-not $script:Transcript) { return }
  try { Stop-Transcript | Out-Null } catch { }
  Remove-Item -LiteralPath $script:Transcript -Force -ErrorAction SilentlyContinue
  $script:Transcript = $null
}
function Write-Diagnostic([string]$Stage) {
  if (-not $DiagnosticProgram) { return }
  $ErrorActionPreference = 'Continue'
  foreach ($program in @($DiagnosticProgram, $SaamRoot)) {
    $reporter = Join-Path $program 'packaging\installer-report.mjs'
    if (Test-Path -LiteralPath $reporter) {
      $reportArgs = @($reporter, $SaamHome, 'stage', $Stage)
      if ($FirstRun) { $reportArgs += '--first-run' }
      if ($Transcript) { $reportArgs += @('--log', $Transcript) }
      & (Join-Path $program 'runtime\node.exe') @reportArgs 2>$null | Out-Null
      return
    }
  }
}

function Stop-WithMessage([string]$Message) {
  Write-Host ''
  Write-Host $Message -ForegroundColor Red
  Write-Diagnostic 'failed'
  Stop-InstallerTranscript
  exit 1
}

# True while SAAM runs: the data folder's instance record names a live node
# process, or a node process runs the installation's packaging\launch.mjs (as
# install.sh). Other node processes from the installation (an agent's saam
# command, client connectors) do not block the program folder's replacement.
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
  $launchers = @((Join-Path $SaamRoot 'packaging\launch.mjs'), (Join-Path $LegacyApp 'packaging\launch.mjs'))
  $launched = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $line = $_.CommandLine; $line -and @($launchers | Where-Object { $line.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count }
  return [bool]$launched
}

function Assert-SaamStopped([string]$Action) {
  if (Test-SaamRunning) {
    Stop-WithMessage "SAAM is running. Choose Quit in Studio or the SAAM tray menu, then $Action again."
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
