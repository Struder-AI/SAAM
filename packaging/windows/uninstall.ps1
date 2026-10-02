# Removes C:\SAAM\app and this user's shortcuts; persistent home data is kept.
param([switch]$Yes)

. (Join-Path $PSScriptRoot 'common.ps1')

function Wait-ForClose { Write-Host ''; Read-Host 'Press Enter to close this window' | Out-Null }

$data = Get-SaamDataFolder
if (Test-SaamRunning) { Write-Host 'SAAM is running. Choose Quit from the tray menu, then uninstall again.' -ForegroundColor Red; Wait-ForClose; exit 1 }
if (-not $Yes) {
  Write-Host "This removes SAAM from $SaamRoot and its shortcuts."
  Write-Host "Your prints and settings in $data are kept."
  if ((Read-Host 'Type Y and press Enter to uninstall') -notmatch '^[Yy]') { Write-Host 'Nothing was removed.'; Wait-ForClose; exit 0 }
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
Write-Host "Your prints remain in $(Join-Path $data 'Prints'); settings and logs are in $(Join-Path $data 'state')."
Write-Host 'Delete that folder yourself if you no longer want them. Installing SAAM again picks them up.'
if (-not $Yes) { Wait-ForClose }
exit 0
