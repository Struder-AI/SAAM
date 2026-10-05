# Installs into C:\SAAM\app, preserving local data and state.
# Legacy data and program additions migrate before transactional replacement.
#
# The package's app folder holds only release.json and these scripts; the
# application is <package>\app.tar. Two ways in, both from this file's place
# in <package>\app\packaging\windows:
#   "Install SAAM.cmd" in the extracted release folder (a person installing), or
#   powershell ... -File <this file> -WaitPid <pid> -Workspace <dir> -WorkspaceToken <token>
# when a running SAAM updates itself from a home tmp workspace: this claims the
# workspace, waits for that SAAM to exit, installs and starts the new SAAM.
# Either way it reports fixed diagnostic stages. Only a home permission failure
# requests native authorization; the rest runs as the original user.
param([int]$WaitPid = 0, [switch]$NoLaunch, [switch]$PrepareHomeOnly,
  [string]$PreparationHome, [string]$PreparationReceipt, [string]$Workspace, [string]$WorkspaceToken)

# The only elevated entry point. It never loads per-user paths or installs files.
function Get-PreparationHome([string]$Path) {
  if ($Path -notmatch '^[A-Za-z]:[\\/]') { throw 'The SAAM home must be an absolute local path.' }
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  if ($full.StartsWith('\\') -or $full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\')) { throw 'The SAAM home cannot be a network path or filesystem root.' }
  foreach ($system in @($env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData)) {
    if ($system -and ($full -ieq $system.TrimEnd('\') -or $full.StartsWith($system.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase))) { throw 'The SAAM home cannot be inside a system folder.' }
  }
  if ($full -ieq $env:USERPROFILE -or $full -ieq (Split-Path -Parent $env:USERPROFILE) -or (Split-Path -Parent $full) -ieq (Split-Path -Parent $env:USERPROFILE)) { throw 'Use a SAAM directory inside the user profile, not the entire profile or Users folder.' }
  $ancestor = $full
  while ($ancestor) {
    if (Test-Path -LiteralPath $ancestor) {
      $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
      if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The SAAM home and its ancestors must be ordinary directories.' }
    }
    $ancestor = Split-Path -Parent $ancestor
  }
  return $full
}

function Prepare-Home([string]$Directory, [bool]$Shared) {
  New-Item -ItemType Directory -Path $Directory -Force -ErrorAction Stop | Out-Null
  $probe = Join-Path $Directory ('write-check-' + [guid]::NewGuid().ToString('N'))
  try { Set-Content -LiteralPath $probe -Value 'SAAM' -Encoding ASCII -ErrorAction Stop }
  finally { if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Force -ErrorAction Stop } }
  if ($Shared) {
    $sid = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
    $acl = Get-Acl -LiteralPath $Directory -ErrorAction Stop
    $required = [Security.AccessControl.FileSystemRights]::Modify
    $inherited = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $existing = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object {
      $_.IdentityReference -eq $sid -and $_.AccessControlType -eq 'Allow' -and
      ($_.FileSystemRights -band $required) -eq $required -and ($_.InheritanceFlags -band $inherited) -eq $inherited
    }
    if (-not $existing) {
      $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, $required, $inherited, 'None', 'Allow')
      $acl.AddAccessRule($rule)
      Set-Acl -LiteralPath $Directory -AclObject $acl -ErrorAction Stop
    }
  }
}

function Test-AccessDenied($ErrorRecord) {
  $exception = $ErrorRecord.Exception
  while ($exception) {
    if ($exception -is [UnauthorizedAccessException] -or $exception -is [Security.SecurityException] -or ($exception.HResult -band 65535) -eq 5) { return $true }
    $exception = $exception.InnerException
  }
  return $false
}

if ($PrepareHomeOnly) {
  $ErrorActionPreference = 'Stop'
  try {
    $prepared = Get-PreparationHome $PreparationHome
    # A receipt is an existing original-user temporary file, never an arbitrary output.
    $receipt = Get-Item -LiteralPath $PreparationReceipt -Force
    if ($receipt.PSIsContainer -or ($receipt.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $receipt.Length -ne 0 -or $receipt.Name -notmatch '^saam-home-[a-f0-9]{32}\.txt$') { throw 'Invalid home preparation receipt.' }
    Set-Content -LiteralPath $PreparationReceipt -Value 'helper-started' -Encoding ASCII
    Prepare-Home $prepared $true
    Add-Content -LiteralPath $PreparationReceipt -Value 'complete' -Encoding ASCII
    exit 0
  } catch {
    Write-Error -ErrorAction Continue "Home preparation failed: $($_.Exception.Message)"
    exit 1
  }
}

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
# Installation stages are first-run evidence until SAAM starts and owns it.
$DiagnosticProgram = $SaamRoot
$FirstRun = $true
trap { Write-Diagnostic 'failed'; break }

# The installer, not its launcher, owns an update's workspace while it reads it.
function Set-WorkspaceOwner([string]$Action) {
  if (-not $Workspace) { return }
  $ErrorActionPreference = 'Continue'
  $ownerArgs = @((Join-Path $SaamRoot 'packaging\installer-report.mjs'), $SaamHome, $Action, $Workspace, $WorkspaceToken, $PID)
  & (Join-Path $SaamRoot 'runtime\node.exe') @ownerArgs 2>$null | Out-Null
}
Set-WorkspaceOwner 'claim'

function Ensure-Home {
  try { $script:SaamHome = Get-PreparationHome $SaamHome; Prepare-Home $SaamHome (-not $isolated); return }
  catch { if (-not (Test-AccessDenied $_)) { throw } }
  if ($isolated) { throw 'The isolated home is not writable; native authorization is disabled for temporary trials.' }
  $receipt = Join-Path ([IO.Path]::GetTempPath()) ('saam-home-' + [guid]::NewGuid().ToString('N') + '.txt')
  New-Item -ItemType File -Path $receipt -ErrorAction Stop | Out-Null
  $helper = $null
  try {
    $quotedScript = $PSCommandPath.Replace("'", "''")
    $quotedHome = $SaamHome.Replace("'", "''")
    $quotedReceipt = $receipt.Replace("'", "''")
    $command = "& '$quotedScript' -PrepareHomeOnly -PreparationHome '$quotedHome' -PreparationReceipt '$quotedReceipt'"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Write-Host 'Home authorization: requested Windows UAC for home preparation only. This does not confirm that a prompt appeared.'
    try {
      $helper = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -PassThru -WindowStyle Hidden -ErrorAction Stop
    } catch {
      $exception = $_.Exception
      while ($exception.InnerException) { $exception = $exception.InnerException }
      if ($exception -is [ComponentModel.Win32Exception] -and $exception.NativeErrorCode -eq 1223) { Write-Host 'Home authorization: cancelled or denied by Windows; no helper started.' }
      elseif (Test-AccessDenied $_) { Write-Host 'Home authorization: denied; no helper started.' }
      else { Write-Host "Home authorization: failed to start helper ($($exception.Message))." }
      throw
    }
    Write-Host 'Home authorization: helper started.'
    $helper.WaitForExit()
    $helper.Refresh()
    if ($helper.ExitCode -ne 0 -or (Get-Content -LiteralPath $receipt) -notcontains 'complete') { throw 'Authorized home preparation did not complete.' }
    Prepare-Home $SaamHome $true
    Write-Host 'Home authorization: complete; original-user access verified.'
  } catch { if ($helper) { Write-Host "Home authorization: failed or incomplete ($($_.Exception.Message))." }; throw }
  finally { Remove-Item -LiteralPath $receipt -Force -ErrorAction SilentlyContinue }
}

# An elevated whole installer cannot safely choose the original desktop identity.
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Stop-WithMessage 'Launch the installer normally, without Run as administrator. It requests UAC itself only if home preparation needs it; your client registration must use your normal account.'
}

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
$requiredFiles = @('runtime/node.exe', 'release.json', 'packaging/launch.mjs', 'scripts/saam.mjs', 'packaging/migrate-home.mjs', 'packaging/client-setup.mjs', 'packaging/installer-report.mjs', 'packaging/windows/SAAM.ico', 'packaging/windows/SAAM.vbs', 'packaging/windows/SAAM.cmd', 'packaging/windows/saam-command.cmd')
# Validate the release payload before even requesting home authorization.
$entries = @(& $tar -tf $archive)
if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'The release archive cannot be read. Nothing was changed.' }
$normalized = @($entries | ForEach-Object { $_ -replace '^\./', '' })
foreach ($entry in $normalized) {
  if ($entry -match '(^[\\/]|:|(^|[\\/])\.\.([\\/]|$))') { Stop-WithMessage 'The release archive contains an unsafe path. Nothing was changed.' }
}
foreach ($required in $requiredFiles) {
  if ($normalized -notcontains $required) { Stop-WithMessage "The release archive has no $required. Nothing was changed." }
}
$manifestEntry = if ($entries -contains './release.json') { './release.json' } else { 'release.json' }
$manifest = & $tar -xOf $archive $manifestEntry
if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'The archived release metadata cannot be read. Nothing was changed.' }
try { if (($manifest -join "`n" | ConvertFrom-Json).version -ne $version) { throw 'Release versions disagree.' } }
catch { Stop-WithMessage "The release archive is invalid ($($_.Exception.Message)). Nothing was changed." }

if ($updating) {
  Write-Host "Updating to SAAM $version from $archive; waiting for SAAM (process $WaitPid) to exit."
  try { Wait-Process -Id $WaitPid -Timeout 60 -ErrorAction SilentlyContinue } catch { }
  if (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) {
    Stop-WithMessage "SAAM (process $WaitPid) did not exit within 60 seconds; the update to $version was not installed."
  }
}
Write-Host "Installing SAAM $version for $env:USERNAME into $SaamRoot."
# The SAAM being updated has exited, so this refuses only another running SAAM.
Assert-SaamStopped 'run "Install SAAM.cmd"'

try { Ensure-Home }
catch { Stop-WithMessage "Cannot prepare the SAAM home ($($_.Exception.Message)). The earlier installation is unchanged." }

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
  foreach ($name in $requiredFiles) {
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
$DiagnosticProgram = $staging
Write-Diagnostic 'candidate-verified'
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
  Write-Diagnostic 'failed'
  $DiagnosticProgram = $null
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
try { Remove-Folder $backup } catch { Write-Host "SAAM was replaced; the earlier installation remains at $backup ($($_.Exception.Message))." }
foreach ($legacy in @($LegacyData, $LegacyApp)) {
  if (Test-Path -LiteralPath $legacy) {
    $resolvedLegacy = [IO.Path]::GetFullPath($legacy).TrimEnd('\')
    if ($resolvedLegacy -ne [IO.Path]::GetFullPath($LegacyData).TrimEnd('\') -and $resolvedLegacy -ne [IO.Path]::GetFullPath($LegacyApp).TrimEnd('\')) { Stop-WithMessage 'Unexpected legacy path; migration cleanup stopped.' }
    $archive = Join-Path $SaamHome ('state\migration\' + (Split-Path -Leaf (Split-Path -Parent $legacy)) + '-' + (Split-Path -Leaf $legacy) + '-' + $transaction)
    New-Item -ItemType Directory -Path (Split-Path -Parent $archive) -Force | Out-Null
    try { Move-Item -LiteralPath $legacy -Destination $archive }
    catch { Write-Host "SAAM is installed; preserved earlier files remain at $legacy ($($_.Exception.Message))." }
  }
}
# Versions before 0.3.3 extracted updates and wrote logs here.
foreach ($leftover in @('state\updates', 'state\logs')) { try { Remove-Folder (Join-Path $SaamHome $leftover) } catch { } }
if (-not $isolated) {
  try {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $SaamRoot) { [Environment]::SetEnvironmentVariable('Path', ($SaamRoot + ';' + $userPath).TrimEnd(';'), 'User') }
  } catch { Write-Host "SAAM is installed; ask the agent to repair PATH registration ($($_.Exception.Message))." }
  $env:Path = $SaamRoot + ';' + $env:Path
}
$clientArgs = @((Join-Path $SaamRoot 'packaging\client-setup.mjs'), $SaamHome)
if ($isolated) { $clientArgs += '--no-register' }
& (Join-Path $SaamRoot 'runtime\node.exe') @clientArgs
if ($LASTEXITCODE -ne 0) { Write-Host 'SAAM is installed; ask the agent to repair client registration.' }

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
Write-Host "SAAM $version is installed."
if (-not $NoShortcuts) { Write-Host 'Start from the SAAM icon; choose Quit from its tray menu to stop. New chats see saam after restarting the client.' }
Write-Host "Your prints and settings stay in $(Get-SaamDataFolder)."
# Startup removes the completed workspace; SAAM owns first-run evidence from here.
Set-WorkspaceOwner 'complete'
if (-not $NoLaunch) {
  Write-Diagnostic 'starting'
  $FirstRun = $false
  Write-Host 'Starting SAAM now. Studio opens in your browser; an alpha invite is optional.'
  if ($isolated) {
    Start-Process -FilePath (Join-Path $SaamRoot 'runtime\node.exe') -ArgumentList (Join-Path $SaamRoot 'packaging\launch.mjs') -WorkingDirectory $env:USERPROFILE -WindowStyle Hidden
  } else {
    Start-Process -FilePath $wscript -ArgumentList $launcher -WorkingDirectory $env:USERPROFILE -WindowStyle Hidden
  }
}
exit 0
