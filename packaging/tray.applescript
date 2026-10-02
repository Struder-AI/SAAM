use framework "AppKit"
use framework "Foundation"
use scripting additions
property statusItem : missing value
property controlPort : missing value
property controlToken : missing value

on callControl(commandName, forceQuit)
  set payload to "{\"command\":\"" & commandName & "\",\"force\":" & forceQuit & "}"
  set resultText to do shell script "/usr/bin/curl --fail --silent --show-error --max-time 35 -H " & quoted form of ("X-SAAM-Control: " & controlToken) & " -H 'Content-Type: application/json' --data " & quoted form of payload & " " & quoted form of ("http://127.0.0.1:" & controlPort & "/control")
  return resultText
end callControl

on openStudio_(sender)
  try
    my callControl("open", "false")
  on error problem
    display alert "SAAM" message problem
  end try
end openStudio_
on updateApp_(sender)
  try
    set responseText to my callControl("update", "false")
    if responseText contains "confirmationRequired" then
      display dialog "Updating SAAM cancels running jobs. Continue?" buttons {"Cancel", "Update"} default button "Cancel"
      my callControl("update", "true")
    end if
  on error problem
    display alert "SAAM" message problem
  end try
end updateApp_
on quitApp_(sender)
  try
    set responseText to my callControl("quit", "false")
    if responseText contains "confirmationRequired" then
      display dialog "SAAM has running jobs. Quit and cancel them?" buttons {"Cancel", "Quit"} default button "Cancel"
      my callControl("quit", "true")
    end if
    current application's NSApp's terminate:me
  on error problem number errorNumber
    if errorNumber is not -128 then display alert "SAAM" message problem
  end try
end quitApp_
on run argv
  set controlPort to item 1 of argv
  set controlToken to item 2 of argv
  set app to current application's NSApplication's sharedApplication()
  app's setActivationPolicy:(current application's NSApplicationActivationPolicyAccessory)
  set statusItem to current application's NSStatusBar's systemStatusBar()'s statusItemWithLength:(current application's NSVariableStatusItemLength)
  statusItem's button()'s setTitle:"SAAM"
  set menu to current application's NSMenu's alloc()'s initWithTitle:"SAAM"
  repeat with entry in {{"Open Studio", "openStudio:"}, {"Update", "updateApp:"}, {"Quit", "quitApp:"}}
    set menuItem to current application's NSMenuItem's alloc()'s initWithTitle:(item 1 of entry) action:(item 2 of entry) keyEquivalent:""
    menuItem's setTarget:me
    menu's addItem:menuItem
  end repeat
  statusItem's setMenu:menu
  log "saam-tray-ready"
  app's run()
end run
