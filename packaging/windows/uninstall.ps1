# Removes C:\SAAM\app, this user's shortcuts, PATH entry and Claude Code and
# Codex registrations; persistent home data is kept.
param([switch]$Yes)

. (Join-Path $PSScriptRoot 'common.ps1')

function Wait-ForClose { Write-Host ''; Read-Host 'Press Enter to close this window' | Out-Null }

$data = Get-SaamDataFolder
if (Test-SaamRunning) { Write-Host 'SAAM is running. Choose Quit in Studio or the SAAM tray menu, then uninstall again.' -ForegroundColor Red; Wait-ForClose; exit 1 }
if (-not $Yes) {
  Write-Host "This removes SAAM from $SaamRoot, with its shortcuts, PATH entry and Claude Code and Codex registrations."
  Write-Host "Your prints and settings in $data are kept."
  if ((Read-Host 'Type Y and press Enter to uninstall') -notmatch '^[Yy]') { Write-Host 'Nothing was removed.'; Wait-ForClose; exit 0 }
}

if (-not $env:SAAM_INSTALL_TEST_ROOT) {
  try { & (Join-Path $SaamRoot 'runtime\node.exe') (Join-Path $SaamRoot 'packaging\client-setup.mjs') $data --unregister; $unregistered = $LASTEXITCODE -eq 0 }
  catch { Write-Host $_.Exception.Message; $unregistered = $false }
  if (-not $unregistered) { Write-Host 'Remove the registrations named above from Claude Code and Codex yourself.' -ForegroundColor Red }
}
foreach ($link in $Shortcuts) { if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force } }
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
[Environment]::SetEnvironmentVariable('Path', (($userPath -split ';' | Where-Object { $_.TrimEnd('\') -ine $SaamRoot.TrimEnd('\') }) -join ';'), 'User')
# This script runs from the folder it removes; leave it first.
Set-Location -LiteralPath $env:TEMP
try { Remove-Folder $SaamRoot }
catch { Write-Host "Could not remove $SaamRoot ($($_.Exception.Message)). Close anything using it and delete the folder." -ForegroundColor Red; Wait-ForClose; exit 1 }

Write-Host ''
Write-Host 'SAAM is uninstalled.' -ForegroundColor Green
Write-Host "Your prints, extensions and remembered setups remain in $(Join-Path $data 'local')."
Write-Host 'Delete that folder yourself if you no longer want them. Installing SAAM again picks them up.'
if (-not $Yes) { Wait-ForClose }
exit 0
