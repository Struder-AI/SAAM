# Brings the browser window and tab showing the Studio at -Port to the front.
# Only the person's own launch or tray click runs this, from the process that
# input started or reached; Windows decides whether it may take the foreground.
# Studio titles itself "SAAM Studio <port>" (studio/app.mjs). A window whose
# title has it shows Studio in its active tab; otherwise the default browser's
# tab strip is searched through UI Automation and the matching tab selected.
# Prints raised, found (Windows kept the foreground elsewhere) or not-found.
param([Parameter(Mandatory)][int]$Port)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class SaamWindows {
  delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  public class Window { public IntPtr Handle; public uint ProcessId; public string Title; }
  public static List<Window> Visible() {
    var windows = new List<Window>();
    EnumWindows((handle, data) => {
      int length = IsWindowVisible(handle) ? GetWindowTextLength(handle) : 0;
      if (length > 0) {
        var title = new StringBuilder(length + 1); uint processId;
        GetWindowText(handle, title, title.Capacity); GetWindowThreadProcessId(handle, out processId);
        windows.Add(new Window { Handle = handle, ProcessId = processId, Title = title.ToString() });
      }
      return true;
    }, IntPtr.Zero);
    return windows;
  }
  // A minimized window is restored only once it has the foreground.
  public static bool Raise(IntPtr window) {
    if (!SetForegroundWindow(window)) return false;
    if (IsIconic(window)) ShowWindow(window, 9);
    return true;
  }
}
'@
$title = "SAAM Studio $Port(\D|$)"
function Find-Studio {
  $windows = [SaamWindows]::Visible()
  foreach ($window in $windows) { if ($window.Title -match $title) { return @{ Handle = $window.Handle; Tab = $null } } }
  # Only the default browser's windows are searched for a background tab; web
  # content (Document) subtrees are skipped, so pages are never walked.
  $progId = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction SilentlyContinue).ProgId
  $command = if ($progId) { (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -ErrorAction SilentlyContinue).'(default)' }
  if ($command -notmatch '^\s*"?([^"]+?\.exe)') { return $null }
  $browser = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($Matches[1])) -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $tabItem = [System.Windows.Automation.ControlType]::TabItem
  $document = [System.Windows.Automation.ControlType]::Document
  foreach ($window in $windows | Where-Object { $browser -contains $_.ProcessId }) {
    try {
      $pending = New-Object System.Collections.Queue
      $pending.Enqueue([System.Windows.Automation.AutomationElement]::FromHandle($window.Handle))
      while ($pending.Count) {
        $child = $walker.GetFirstChild($pending.Dequeue())
        while ($child) {
          $type = $child.Current.ControlType
          if ($type -eq $tabItem -and $child.Current.Name -match $title) { return @{ Handle = $window.Handle; Tab = $child } }
          if ($type -ne $document) { $pending.Enqueue($child) }
          $child = $walker.GetNextSibling($child)
        }
      }
    } catch [System.Windows.Automation.ElementNotAvailableException] { }
  }
  return $null
}
$studio = Find-Studio
if (-not $studio) { 'not-found'; return }
if (-not [SaamWindows]::Raise($studio.Handle)) { 'found'; return }
# The tab is selected only in a window that came forward.
$pattern = $null
if ($studio.Tab -and $studio.Tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select() }
elseif ($studio.Tab -and $studio.Tab.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke() }
'raised'
