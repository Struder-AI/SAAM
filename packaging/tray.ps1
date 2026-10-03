param([int]$Port,[string]$Token,[int]$AppPid)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Invoke-Control([string]$Command,[bool]$Force=$false,[string]$StudioInstanceId='') {
  $body = @{command=$Command;force=$Force;studioInstanceId=$StudioInstanceId} | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri "http://127.0.0.1:$Port/control" -Method Post -Headers @{'X-SAAM-Control'=$Token} -ContentType 'application/json' -Body $body -TimeoutSec 35
}
function Show-Problem($Problem) { [System.Windows.Forms.MessageBox]::Show([string]$Problem,'SAAM') | Out-Null }
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Text = 'SAAM'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Open Studio')
$open.add_Click({ try { Invoke-Control 'open' | Out-Null } catch { Show-Problem $_.Exception.Message } })
$runtimes = $menu.Items.Add('Studios')
$newInstance = $menu.Items.Add('New Instance')
$newInstance.add_Click({ try { Invoke-Control 'new-instance' | Out-Null } catch { Show-Problem $_.Exception.Message } })
$update = $menu.Items.Add('Update')
$update.Visible = $false
function Refresh-Menu {
  try {
    $status = Invoke-Control 'status'
    $update.Visible = [bool]$status.service.activated -and [bool]$status.service.update
    $runtimes.DropDownItems.Clear()
    foreach ($studio in $status.studios) {
      $part = if ($studio.printId) { $studio.printId } else { 'Empty Studio' }
      $chat = if ($studio.attachment) { $studio.attachment.name } else { 'No chat attached' }
      $item = $runtimes.DropDownItems.Add("$part - $chat [$($studio.instanceId)]")
      $item.Tag = $studio.instanceId
      $item.add_Click({ param($sender,$eventArgs) try { Invoke-Control 'open' $false $sender.Tag | Out-Null } catch { Show-Problem $_.Exception.Message } })
    }
    $runtimes.Enabled = $runtimes.DropDownItems.Count -gt 0
  } catch { $update.Visible = $false;$runtimes.Enabled = $false }
}
$menu.add_Opening({ Refresh-Menu })
$update.add_Click({
  try {
    $result = Invoke-Control 'update'
    if ($result.confirmationRequired) {
      $answer = [System.Windows.Forms.MessageBox]::Show('Updating SAAM cancels running jobs. Continue?','Update SAAM',[System.Windows.Forms.MessageBoxButtons]::YesNo)
      if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { Invoke-Control 'update' $true | Out-Null }
    }
  } catch { Show-Problem $_.Exception.Message }
})
$quit = $menu.Items.Add('Quit')
$quit.add_Click({
  try {
    $status = Invoke-Control 'status'
    if ($status.jobs.Count -gt 0) {
      $answer = [System.Windows.Forms.MessageBox]::Show('SAAM has running jobs. Quit and cancel them?','Quit SAAM',[System.Windows.Forms.MessageBoxButtons]::YesNo)
      if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    }
    Invoke-Control 'quit' $true | Out-Null
    [System.Windows.Forms.Application]::Exit()
  } catch { Show-Problem $_.Exception.Message }
})
$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({ try { Invoke-Control 'open' | Out-Null } catch { Show-Problem $_.Exception.Message } })
$notify.Visible = $true
Write-Output 'saam-tray-ready'
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({ if (-not (Get-Process -Id $AppPid -ErrorAction SilentlyContinue)) { [System.Windows.Forms.Application]::Exit() } elseif (-not $menu.Visible) { Refresh-Menu } })
$timer.Start()
try { [System.Windows.Forms.Application]::Run() } finally { $timer.Stop();$timer.Dispose();$notify.Visible=$false;$notify.Dispose();$menu.Dispose() }
