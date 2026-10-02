# Installs into C:\SAAM\app, preserving Prints, extensions and state.
# Legacy data and program additions migrate before transactional replacement.
#
# The package's app folder holds only release.json and these scripts; the
# application is <package>\app.tar. Two ways in, both from this file's place
# in <package>\app\packaging\windows:
#   "Install SAAM.cmd" in the extracted release folder (a person installing), or
#   powershell -NoProfile -ExecutionPolicy Bypass -File <this file> -WaitPid <pid>
# when a running SAAM updates itself: it waits for that SAAM to exit, installs
# without prompts, logs to <data>\logs\update.log and starts the new SAAM.
param([int]$WaitPid = 0, [switch]$NoLaunch)

. (Join-Path $PSScriptRoot 'common.ps1')
$isolated = [bool]$env:SAAM_INSTALL_TEST_ROOT
if ($isolated) {
  # The detached in-app updater inherits this root during a disposable trial.
  $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  $resolved = [IO.Path]::GetFullPath($env:SAAM_INSTALL_TEST_ROOT).TrimEnd('\')
  if (-not $resolved.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase)) {
    Stop-WithMessage 'SAAM_INSTALL_TEST_ROOT must be under the temporary folder.'
  }
  $SaamHome = $resolved
  $SaamRoot = Join-Path $SaamHome 'app'
  $LegacyData = Join-Path $SaamHome 'legacy-data'
  $LegacyApp = Join-Path $SaamHome 'legacy-app'
}
$NoShortcuts = $isolated

$updating = $WaitPid -gt 0
if ($updating) {
  $logs = Join-Path $SaamHome 'state\logs'
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
if ($version -notmatch '^\d{1,6}\.\d{1,6}\.\d{1,6}$') { Stop-WithMessage 'The release has no valid version. Nothing was changed.' }

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

try {
  New-Item -ItemType Directory -Path $SaamHome -Force | Out-Null
  $probe = Join-Path $SaamHome ('write-check-' + [guid]::NewGuid().ToString('N'))
  Set-Content -LiteralPath $probe -Value 'SAAM' -Encoding ASCII
  Remove-Item -LiteralPath $probe -Force
  if (-not $isolated) {
    # The home is shared by this machine's Windows users, not a per-user root.
    & (Join-Path $env:SystemRoot 'System32\icacls.exe') $SaamHome /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot grant the Windows Users group write access. Have the owner grant Modify on C:\SAAM, then retry.' }
  }
} catch { Stop-WithMessage "Cannot prepare the SAAM home ($($_.Exception.Message)). The earlier installation is unchanged." }

# Unpack into a staging folder next to the installation first, so a failed
# unpack leaves any installed SAAM as it was.
$programs = Split-Path -Parent $SaamRoot
$transaction = [guid]::NewGuid().ToString('N')
$staging = Join-Path $programs ('SAAM.installing-' + $transaction)
$backup = Join-Path $programs ('SAAM.previous-' + $transaction)
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Write-Host 'Unpacking SAAM...'
& $tar -xf $archive -C $staging
$tarExit = $LASTEXITCODE
if ($tarExit -ne 0) {
  Remove-Folder $staging
  Stop-WithMessage "Unpacking SAAM failed (tar exit code $tarExit). Nothing was changed."
}
try {
  foreach ($name in @('runtime\node.exe', 'release.json', 'packaging\launch.mjs', 'scripts\saam.mjs', 'packaging\migrate-home.mjs', 'packaging\client-setup.mjs', 'packaging\windows\SAAM.ico', 'packaging\windows\SAAM.vbs', 'packaging\windows\SAAM.cmd', 'packaging\windows\saam-command.cmd')) {
    if (-not (Test-Path -LiteralPath (Join-Path $staging $name) -PathType Leaf)) { throw "The candidate has no $name." }
  }
  $candidate = Get-Content -LiteralPath (Join-Path $staging 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($candidate.version -ne $version) { throw 'The candidate version does not match the release.' }
  & (Join-Path $staging 'runtime\node.exe') --version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'The candidate Node runtime cannot run.' }
} catch {
  Remove-Folder $staging
  Stop-WithMessage "Verifying SAAM failed ($($_.Exception.Message)). Nothing was changed."
}
# The launchers are written fresh rather than unpacked, so they never carry a
# download mark and Windows does not warn at every start.
foreach ($name in @('SAAM.vbs', 'SAAM.cmd')) {
  $lines = Get-Content -LiteralPath (Join-Path $staging "packaging\windows\$name")
  $installedName = $name
  if ($name -eq 'SAAM.cmd') { $installedName = 'SAAM-console.cmd' }
  Set-Content -LiteralPath (Join-Path $staging $installedName) -Value $lines -Encoding ASCII
}
Copy-Item -LiteralPath (Join-Path $staging 'packaging\windows\saam-command.cmd') -Destination (Join-Path $staging 'saam.cmd')
try {
  & (Join-Path $staging 'runtime\node.exe') (Join-Path $staging 'packaging\migrate-home.mjs') $SaamHome $LegacyData $LegacyApp
  if ($LASTEXITCODE -ne 0) { throw 'Legacy data migration did not complete.' }
} catch {
  Remove-Folder $staging
  Stop-WithMessage "Migration failed ($($_.Exception.Message)). The earlier installation and legacy source data are preserved."
}

try {
  if (Test-Path -LiteralPath $SaamRoot) { Rename-Item -LiteralPath $SaamRoot -NewName (Split-Path -Leaf $backup) }
  Rename-Item -LiteralPath $staging -NewName (Split-Path -Leaf $SaamRoot)
} catch {
  $replacementError = $_.Exception.Message
  if (Test-Path -LiteralPath $backup) {
    try { Rename-Item -LiteralPath $backup -NewName (Split-Path -Leaf $SaamRoot) }
    catch { Stop-WithMessage "Replacement failed ($replacementError); restoring also failed ($($_.Exception.Message)). Your earlier SAAM is preserved at $backup. Close programs using these folders before restoring it to $SaamRoot." }
  }
  Remove-Folder $staging
  Stop-WithMessage "Could not replace SAAM ($replacementError). The earlier installation is unchanged or restored. Close programs using $SaamRoot and try again."
}
try { Remove-Folder $backup } catch { Write-Step "SAAM was replaced; the earlier installation remains at $backup ($($_.Exception.Message))." }
foreach ($legacy in @($LegacyData, $LegacyApp)) {
  if (Test-Path -LiteralPath $legacy) {
    $resolvedLegacy = [IO.Path]::GetFullPath($legacy).TrimEnd('\')
    if ($resolvedLegacy -ne [IO.Path]::GetFullPath($LegacyData).TrimEnd('\') -and $resolvedLegacy -ne [IO.Path]::GetFullPath($LegacyApp).TrimEnd('\')) { Stop-WithMessage 'Unexpected legacy path; migration cleanup stopped.' }
    $archive = Join-Path $SaamHome ('state\migration\' + (Split-Path -Leaf (Split-Path -Parent $legacy)) + '-' + (Split-Path -Leaf $legacy) + '-' + $transaction)
    New-Item -ItemType Directory -Path (Split-Path -Parent $archive) -Force | Out-Null
    try { Move-Item -LiteralPath $legacy -Destination $archive }
    catch { Write-Step "SAAM is installed; preserved earlier files remain at $legacy ($($_.Exception.Message))." }
  }
}
if (-not $isolated) {
  try {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $SaamRoot) { [Environment]::SetEnvironmentVariable('Path', ($SaamRoot + ';' + $userPath).TrimEnd(';'), 'User') }
  } catch { Write-Step "SAAM is installed; ask the agent to repair PATH registration ($($_.Exception.Message))." }
  $env:Path = $SaamRoot + ';' + $env:Path
}
$clientArgs = @((Join-Path $SaamRoot 'packaging\client-setup.mjs'), $SaamHome)
if ($isolated) { $clientArgs += '--no-register' }
& (Join-Path $SaamRoot 'runtime\node.exe') @clientArgs
if ($LASTEXITCODE -ne 0) { Write-Step 'SAAM is installed; ask the agent to repair client registration.' }

# An update refreshes only the shortcuts the person still has; it adds the
# console shortcut for someone who keeps the Start Menu one.
if (-not $NoShortcuts) {
$keepConsole = (-not $updating) -or (Test-Path -LiteralPath $StartMenuLink) -or (Test-Path -LiteralPath $ConsoleLink)
$shell = New-Object -ComObject WScript.Shell
function Set-Shortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$Description, [bool]$Create = $false) {
  if ($updating -and -not $Create -and -not (Test-Path -LiteralPath $Path)) { return }
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = $Target
  $link.Arguments = $Arguments
  $link.WorkingDirectory = $SaamHome
  $link.Description = $Description
  if ($Target -eq $wscript) { $link.IconLocation = (Join-Path $SaamRoot 'packaging\windows\SAAM.ico') + ',0' }
  $link.Save()
}
# The SAAM shortcuts start the persistent tray application.
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$launcher = "`"$(Join-Path $SaamRoot 'SAAM.vbs')`""
Set-Shortcut $StartMenuLink $wscript $launcher "SAAM $version"
Set-Shortcut $DesktopLink $wscript $launcher "SAAM $version"
if ($keepConsole) { Set-Shortcut $ConsoleLink (Join-Path $SaamRoot 'SAAM-console.cmd') '' "SAAM $version with a console window, for troubleshooting" $true }
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$uninstaller = Join-Path $SaamRoot 'packaging\windows\uninstall.ps1'
Set-Shortcut $UninstallLink $powershell "-NoProfile -ExecutionPolicy Bypass -File `"$uninstaller`"" 'Uninstall SAAM (your prints are kept)'
}

Write-Host ''
Write-Step "SAAM $version is installed."
if (-not $NoShortcuts) { Write-Host 'Start from the SAAM icon; choose Quit from its tray menu to stop. New chats see saam after restarting the client.' }
Write-Host "Your prints and settings stay in $(Get-SaamDataFolder)."
if (-not $NoLaunch) {
  Write-Host 'Starting SAAM now. Studio opens in your browser; an alpha invite is optional.'
  if ($isolated) {
    Start-Process -FilePath (Join-Path $SaamRoot 'runtime\node.exe') -ArgumentList (Join-Path $SaamRoot 'packaging\launch.mjs') -WorkingDirectory $env:USERPROFILE -WindowStyle Hidden
  } else {
    Start-Process -FilePath $wscript -ArgumentList $launcher -WorkingDirectory $env:USERPROFILE -WindowStyle Hidden
  }
  Write-Log 'Started SAAM.'
}
exit 0
