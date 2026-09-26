# Installs SAAM for the current Windows user, without administrator rights.
# It copies the package's app folder to %LOCALAPPDATA%\Programs\SAAM
# (replacing an earlier installation), creates the SAAM shortcuts and starts
# SAAM. The data folder, which holds the prints, is never touched: to go back
# to an older version, install its ZIP the same way.
#
# Two ways in, both from this file's place in <package>\app\packaging\windows:
#   "Install SAAM.cmd" in the extracted release folder (a person installing), or
#   powershell -NoProfile -ExecutionPolicy Bypass -File <this file> -WaitPid <pid>
# when a running SAAM updates itself: it waits for that SAAM to exit, installs
# without prompts, logs to <data>\logs\update.log and starts the new SAAM.
param([int]$WaitPid = 0)

. (Join-Path $PSScriptRoot 'common.ps1')

$updating = $WaitPid -gt 0
if ($updating) {
  $logs = Join-Path (Get-SaamDataFolder) 'logs'
  New-Item -ItemType Directory -Path $logs -Force | Out-Null
  $UpdateLog = Join-Path $logs 'update.log'
}
# Nothing else reaches an update's log, so an unexpected failure is written there too.
trap { Write-Log "Update failed: $($_.Exception.Message)"; break }

function Write-Step([string]$Message) { Write-Log $Message; Write-Host $Message }

# Work from outside the folder being replaced (SAAM may have started us from there).
Set-Location -LiteralPath $env:TEMP

$source = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$releaseFile = Join-Path $source 'release.json'
if (-not (Test-Path -LiteralPath $releaseFile) -or -not (Test-Path -LiteralPath (Join-Path $source 'runtime\node.exe'))) {
  Stop-WithMessage 'This is not a complete SAAM release folder. Extract the whole ZIP, then run "Install SAAM.cmd" again.'
}
if ($source.TrimEnd('\') -ieq $SaamRoot) { Stop-WithMessage 'Run "Install SAAM.cmd" from the extracted release folder, not from the installed SAAM.' }
$version = [string](Get-Content -LiteralPath $releaseFile -Raw -Encoding UTF8 | ConvertFrom-Json).version

if ($updating) {
  Write-Step "Updating to SAAM $version from $source; waiting for SAAM (process $WaitPid) to exit."
  try { Wait-Process -Id $WaitPid -Timeout 60 -ErrorAction SilentlyContinue } catch { }
  if (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) {
    Stop-WithMessage "SAAM (process $WaitPid) did not exit within 60 seconds; the update to $version was not installed."
  }
}
Write-Step "Installing SAAM $version for $env:USERNAME into $SaamRoot."
# The SAAM being updated has exited, so this refuses only another running SAAM.
Assert-SaamStopped 'run "Install SAAM.cmd"'

# Copy into a staging folder first, so a failed copy leaves any installed
# SAAM as it was.
$programs = Split-Path -Parent $SaamRoot
$staging = Join-Path $programs 'SAAM.installing'
New-Item -ItemType Directory -Path $programs -Force | Out-Null
Remove-Folder $staging
Write-Host 'Copying files...'
robocopy $source $staging /E /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { Remove-Folder $staging; Stop-WithMessage "Copying SAAM failed (robocopy exit code $LASTEXITCODE). Nothing was changed." }
# The launcher the shortcuts start is written fresh rather than copied, so it
# carries no download mark and Windows does not warn at every start.
$launcherLines = Get-Content -LiteralPath (Join-Path $source 'packaging\windows\SAAM.cmd')
Set-Content -LiteralPath (Join-Path $staging 'SAAM.cmd') -Value $launcherLines -Encoding ASCII

try {
  Remove-Folder $SaamRoot
  Rename-Item -LiteralPath $staging -NewName (Split-Path -Leaf $SaamRoot)
} catch {
  Stop-WithMessage "Could not replace the earlier SAAM in $SaamRoot ($($_.Exception.Message)). Close any window or program using that folder, then run `"Install SAAM.cmd`" again."
}

# An update refreshes only the shortcuts the person still has.
$shell = New-Object -ComObject WScript.Shell
function Set-Shortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$Description) {
  if ($updating -and -not (Test-Path -LiteralPath $Path)) { return }
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = $Target
  $link.Arguments = $Arguments
  $link.WorkingDirectory = $env:USERPROFILE
  $link.Description = $Description
  $link.Save()
}
$launcher = Join-Path $SaamRoot 'SAAM.cmd'
Set-Shortcut $Shortcuts[0] $launcher '' "SAAM $version"
Set-Shortcut $Shortcuts[1] $launcher '' "SAAM $version"
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$uninstaller = Join-Path $SaamRoot 'packaging\windows\uninstall.ps1'
Set-Shortcut $Shortcuts[2] $powershell "-NoProfile -ExecutionPolicy Bypass -File `"$uninstaller`"" 'Uninstall SAAM (your prints are kept)'

Write-Host ''
Write-Step "SAAM $version is installed."
Write-Host "Start it any time from the SAAM shortcut on the Start Menu or Desktop."
Write-Host "Your prints and settings stay in $(Get-SaamDataFolder)."
Write-Host 'Starting SAAM now. Studio opens in your browser; use its Connect chat panel to link your chat.'
Start-Process -FilePath $launcher -WorkingDirectory $env:USERPROFILE
Write-Log 'Started SAAM.'
exit 0
