param([int]$Port,[string]$Token,[int]$AppPid,[string]$RaiseScript)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Invoke-Control([string]$Command,[bool]$Force=$false,[string]$StudioInstanceId='',[string]$RuntimeId='',[string]$Display='') {
  $body = @{command=$Command;force=$Force;studioInstanceId=$StudioInstanceId;runtimeId=$RuntimeId;display=$Display} | ConvertTo-Json -Compress
  # Without -TimeoutSec the request waits while SAAM works on it, such as an open that
  # starts a runtime. A failure throws SAAM's error (its 400 body), else the HTTP error.
  try { Invoke-RestMethod -Uri "http://127.0.0.1:$Port/control" -Method Post -Headers @{'X-SAAM-Control'=$Token} -ContentType 'application/json' -Body $body }
  catch {
    $problem = $_
    $failure = try { (New-Object System.IO.StreamReader($problem.Exception.Response.GetResponseStream())).ReadToEnd() | ConvertFrom-Json } catch { $null }
    if ($failure.error) { throw [string]$failure.error }
    throw $problem
  }
}
function Show-Problem($Problem) { [System.Windows.Forms.MessageBox]::Show([string]$Problem,'SAAM') | Out-Null }
# A click opens Studio and this process, which received it, shows the window
# SAAM answers (studio/browser.mjs showOpened does the same for a launch).
function Show-Studio([string]$Command,[string]$StudioInstanceId='',[string]$RuntimeId='') {
  $answer = Invoke-Control $Command $false $StudioInstanceId $RuntimeId 'caller'
  if ($answer.display -eq 'raise') {
    $outcome = try { & $RaiseScript -Port ([Uri]$answer.url).Port } catch { 'not-found' }
    if ($outcome -ne 'not-found') { return }
  }
  if ($answer.display -eq 'raise' -or $answer.display -eq 'open') { Start-Process $answer.url }
}
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Text = 'SAAM'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Open Studio')
$open.add_Click({ try { Show-Studio 'open' } catch { Show-Problem $_.Exception.Message } })
$runtimes = $menu.Items.Add('Studios')
$newInstance = $menu.Items.Add('New Instance')
$newInstance.add_Click({ try { Show-Studio 'new-instance' } catch { Show-Problem $_.Exception.Message } })
$update = $menu.Items.Add('Update')
$update.Visible = $false
function Refresh-Menu {
  try {
    $status = Invoke-Control 'status'
    $update.Visible = [bool]$status.service.activated -and [bool]$status.service.update
    $runtimes.DropDownItems.Clear()
    foreach ($runtime in $status.runtimes) {
      $group = $runtimes.DropDownItems.Add($runtime.label)
      $show = $group.DropDownItems.Add('Open Studio')
      $show.Tag = $runtime.id
      $show.add_Click({ param($sender,$eventArgs) try { Show-Studio 'open' '' $sender.Tag } catch { Show-Problem $_.Exception.Message } })
      foreach ($studio in $status.studios | Where-Object { $_.runtimeId -eq $runtime.id }) {
        $part = if ($studio.printId) { $studio.printId } else { 'Empty Studio' }
        $chat = if ($studio.attachment) { $studio.attachment.name } else { 'No chat attached' }
        $item = $group.DropDownItems.Add("$part - $chat [$($studio.instanceId)]")
        $item.Tag = $studio.instanceId
        $item.add_Click({ param($sender,$eventArgs) try { Show-Studio 'open' $sender.Tag } catch { Show-Problem $_.Exception.Message } })
      }
      if ($runtime.id -ne 'installed') {
        $stop = $group.DropDownItems.Add('Stop runtime')
        $stop.Tag = $runtime.id
        $stop.add_Click({ param($sender,$eventArgs) try {
          $result = Invoke-Control 'stop-runtime' $false '' $sender.Tag
          if ($result.confirmationRequired) {
            $answer = [System.Windows.Forms.MessageBox]::Show("$($result.message)`nContinue?",'SAAM',[System.Windows.Forms.MessageBoxButtons]::YesNo)
            if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { Invoke-Control 'stop-runtime' $true '' $sender.Tag | Out-Null }
          }
        } catch { Show-Problem $_.Exception.Message } })
      }
    }
    $runtimes.Enabled = $runtimes.DropDownItems.Count -gt 0
  } catch { $update.Visible = $false;$runtimes.Enabled = $false }
}
$menu.add_Opening({ Refresh-Menu })
$update.add_Click({
  try {
    $result = Invoke-Control 'update'
    if ($result.confirmationRequired) {
      $answer = [System.Windows.Forms.MessageBox]::Show("$($result.message)`nContinue?",'Update SAAM',[System.Windows.Forms.MessageBoxButtons]::YesNo)
      if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { Invoke-Control 'update' $true | Out-Null }
    }
  } catch { Show-Problem $_.Exception.Message }
})
$quit = $menu.Items.Add('Quit')
$quit.add_Click({
  try {
    $result = Invoke-Control 'quit'
    if ($result.confirmationRequired) {
      $answer = [System.Windows.Forms.MessageBox]::Show([string]$result.message,'Quit SAAM',[System.Windows.Forms.MessageBoxButtons]::YesNo)
      if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
      Invoke-Control 'quit' $true | Out-Null
    }
    [System.Windows.Forms.Application]::Exit()
  } catch { Show-Problem $_.Exception.Message }
})
$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({ try { Show-Studio 'open' } catch { Show-Problem $_.Exception.Message } })
$notify.Visible = $true
Write-Output 'saam-tray-ready'
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({ if (-not (Get-Process -Id $AppPid -ErrorAction SilentlyContinue)) { [System.Windows.Forms.Application]::Exit() } elseif (-not $menu.Visible) { Refresh-Menu } })
$timer.Start()
try { [System.Windows.Forms.Application]::Run() } finally { $timer.Stop();$timer.Dispose();$notify.Visible=$false;$notify.Dispose();$menu.Dispose() }
