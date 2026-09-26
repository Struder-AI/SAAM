# Shared by install.ps1 and uninstall.ps1 (dot-sourced).
# Windows PowerShell 5.1 compatible; ASCII only.
#
# A per-user installation, no administrator rights:
#   %LOCALAPPDATA%\Programs\SAAM\   the application (replaced by each install)
#   %LOCALAPPDATA%\SAAM\            the data folder: prints, pairing, logs.
#                                   These scripts never touch it.

$ErrorActionPreference = 'Stop'

$SaamRoot = Join-Path $env:LOCALAPPDATA 'Programs\SAAM'
$StartMenu = [Environment]::GetFolderPath('Programs')
$Desktop = [Environment]::GetFolderPath('Desktop')
$Shortcuts = @((Join-Path $StartMenu 'SAAM.lnk'), (Join-Path $Desktop 'SAAM.lnk'), (Join-Path $StartMenu 'Uninstall SAAM.lnk'))

function Get-SaamDataFolder {
  # Matches packaging/launch.mjs: SAAM_DATA overrides the default.
  if ($env:SAAM_DATA) { return $env:SAAM_DATA }
  return (Join-Path $env:LOCALAPPDATA 'SAAM')
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
  $record = Join-Path (Get-SaamDataFolder) 'instance.json'
  if (Test-Path -LiteralPath $record) {
    try {
      $instance = Get-Content -LiteralPath $record -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($instance.pid) {
        $process = Get-Process -Id ([int]$instance.pid) -ErrorAction SilentlyContinue
        if ($process -and $process.ProcessName -eq 'node') { return $true }
      }
    } catch { }
  }
  $fromInstall = Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($SaamRoot + '\', [StringComparison]::OrdinalIgnoreCase) }
  return [bool]$fromInstall
}

function Assert-SaamStopped([string]$Action) {
  if (Test-SaamRunning) {
    Stop-WithMessage "SAAM is running. Close the SAAM window (this stops SAAM), then $Action again."
  }
}

# Removes a folder, including paths longer than 260 characters that
# Remove-Item cannot reach in Windows PowerShell 5.1: robocopy mirrors an
# empty folder over it first.
function Remove-Folder([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $empty = Join-Path ([IO.Path]::GetTempPath()) ('saam-empty-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $empty | Out-Null
  try { robocopy $empty $Path /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null }
  finally { Remove-Item -LiteralPath $empty -Force }
  Remove-Item -LiteralPath $Path -Recurse -Force
}
