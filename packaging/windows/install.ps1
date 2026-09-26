# Installs SAAM for the current Windows user, without administrator rights.
# It unpacks the package's app.tar into %LOCALAPPDATA%\Programs\SAAM
# (replacing an earlier installation), creates the SAAM shortcuts and starts
# SAAM. The data folder, which holds the prints, is never touched: to go back
# to an older version, install its ZIP the same way.
#
# The package's app folder holds only release.json and these scripts; the
# application is <package>\app.tar. Two ways in, both from this file's place
# in <package>\app\packaging\windows:
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
if ($source.TrimEnd('\') -ieq $SaamRoot) { Stop-WithMessage 'Run "Install SAAM.cmd" from the extracted release folder, not from the installed SAAM.' }
$releaseFile = Join-Path $source 'release.json'
$archive = Join-Path (Split-Path -Parent $source) 'app.tar'
if (-not (Test-Path -LiteralPath $releaseFile) -or -not (Test-Path -LiteralPath $archive)) {
  Stop-WithMessage 'This is not a complete SAAM release folder. Extract the whole ZIP, then run "Install SAAM.cmd" again.'
}
# Windows' own tar (Windows 10 version 1803 and later); a tar earlier on PATH may not be bsdtar.
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path -LiteralPath $tar)) { Stop-WithMessage "This Windows has no $tar, which SAAM's installer needs (Windows 10 version 1803 or later)." }
$version = [string](Get-Content -LiteralPath $releaseFile -Raw -Encoding UTF8 | ConvertFrom-Json).version

if ($updating) {
  Write-Step "Updating to SAAM $version from $archive; waiting for SAAM (process $WaitPid) to exit."
  try { Wait-Process -Id $WaitPid -Timeout 60 -ErrorAction SilentlyContinue } catch { }
  if (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) {
    Stop-WithMessage "SAAM (process $WaitPid) did not exit within 60 seconds; the update to $version was not installed."
  }
}
Write-Step "Installing SAAM $version for $env:USERNAME into $SaamRoot."
# The SAAM being updated has exited, so this refuses only another running SAAM.
Assert-SaamStopped 'run "Install SAAM.cmd"'

# Unpack into a staging folder next to the installation first, so a failed
# unpack leaves any installed SAAM as it was.
$programs = Split-Path -Parent $SaamRoot
$staging = Join-Path $programs 'SAAM.installing'
Remove-Folder $staging
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Write-Host 'Unpacking SAAM...'
& $tar -xf $archive -C $staging
$tarExit = $LASTEXITCODE
if ($tarExit -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $staging 'runtime\node.exe'))) {
  Remove-Folder $staging
  Stop-WithMessage "Unpacking SAAM failed (tar exit code $tarExit). Nothing was changed."
}
# The launchers are written fresh rather than unpacked, so they never carry a
# download mark and Windows does not warn at every start.
foreach ($name in @('SAAM.vbs', 'SAAM.cmd')) {
  $lines = Get-Content -LiteralPath (Join-Path $staging "packaging\windows\$name")
  Set-Content -LiteralPath (Join-Path $staging $name) -Value $lines -Encoding ASCII
}

try {
  Remove-Folder $SaamRoot
  Rename-Item -LiteralPath $staging -NewName (Split-Path -Leaf $SaamRoot)
} catch {
  Stop-WithMessage "Could not replace the earlier SAAM in $SaamRoot ($($_.Exception.Message)). Close any window or program using that folder, then run `"Install SAAM.cmd`" again."
}

# An update refreshes only the shortcuts the person still has; it adds the
# console shortcut for someone who keeps the Start Menu one.
$keepConsole = (-not $updating) -or (Test-Path -LiteralPath $StartMenuLink) -or (Test-Path -LiteralPath $ConsoleLink)
$shell = New-Object -ComObject WScript.Shell
function Set-Shortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$Description, [bool]$Create = $false) {
  if ($updating -and -not $Create -and -not (Test-Path -LiteralPath $Path)) { return }
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = $Target
  $link.Arguments = $Arguments
  $link.WorkingDirectory = $env:USERPROFILE
  $link.Description = $Description
  if ($Target -eq $wscript) { $link.IconLocation = (Join-Path $SaamRoot 'runtime\node.exe') + ',0' }
  $link.Save()
}
# The SAAM shortcuts start it without a window; Quit SAAM in Studio stops it.
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$launcher = "`"$(Join-Path $SaamRoot 'SAAM.vbs')`""
Set-Shortcut $StartMenuLink $wscript $launcher "SAAM $version"
Set-Shortcut $DesktopLink $wscript $launcher "SAAM $version"
if ($keepConsole) { Set-Shortcut $ConsoleLink (Join-Path $SaamRoot 'SAAM.cmd') '' "SAAM $version with a console window, for troubleshooting" $true }
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$uninstaller = Join-Path $SaamRoot 'packaging\windows\uninstall.ps1'
Set-Shortcut $UninstallLink $powershell "-NoProfile -ExecutionPolicy Bypass -File `"$uninstaller`"" 'Uninstall SAAM (your prints are kept)'

Write-Host ''
Write-Step "SAAM $version is installed."
Write-Host "Start it any time from the SAAM shortcut on the Start Menu or Desktop; stop it with Quit SAAM in Studio."
Write-Host "Your prints and settings stay in $(Get-SaamDataFolder)."
Write-Host 'Starting SAAM now. Studio opens in your browser; use its Connect chat panel to link your chat.'
Start-Process -FilePath $wscript -ArgumentList $launcher -WorkingDirectory $env:USERPROFILE
Write-Log 'Started SAAM.'
exit 0
