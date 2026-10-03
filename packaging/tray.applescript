use framework "AppKit"
use framework "Foundation"
use scripting additions
property statusItem : missing value
property controlPort : missing value
property controlToken : missing value
property trayMenu : missing value
property updateItem : missing value
property runtimeItem : missing value

on callControl(commandName, forceQuit)
  return my sendControl("{\"command\":\"" & commandName & "\",\"force\":" & forceQuit & "}")
end callControl
on sendControl(payload)
  set resultText to do shell script "/usr/bin/curl --fail --silent --show-error --max-time 35 -H " & quoted form of ("X-SAAM-Control: " & controlToken) & " -H 'Content-Type: application/json' --data " & quoted form of payload & " " & quoted form of ("http://127.0.0.1:" & controlPort & "/control")
  return resultText
end sendControl

on newInstance_(sender)
  try
    my callControl("new-instance", "false")
  on error problem
    display alert "SAAM" message problem
  end try
end newInstance_
on openRuntime_(sender)
  try
    -- The application supplies hexadecimal Studio identities, never shell code.
    my sendControl("{\"command\":\"open\",\"studioInstanceId\":\"" & (sender's representedObject() as text) & "\"}")
  on error problem
    display alert "SAAM" message problem
  end try
end openRuntime_
on refreshMenu_(sender)
  try
    set statusText to my callControl("status", "false")
    set statusData to (current application's NSString's stringWithString:statusText)'s dataUsingEncoding:(current application's NSUTF8StringEncoding)
    set appStatus to current application's NSJSONSerialization's JSONObjectWithData:statusData options:0 |error|:(missing value)
    set serviceStatus to appStatus's objectForKey:"service"
    set paired to (serviceStatus's objectForKey:"activated")'s boolValue()
    set offer to serviceStatus's objectForKey:"update"
    updateItem's setHidden:(not (paired and offer is not missing value and offer is not current application's NSNull's null()))
    set runtimeMenu to runtimeItem's submenu()
    runtimeMenu's removeAllItems()
    repeat with studio in (appStatus's objectForKey:"studios")
      set identity to studio's objectForKey:"instanceId"
      set partName to studio's objectForKey:"printId"
      if partName is missing value or partName is current application's NSNull's null() then set partName to "Empty Studio"
      set attachment to studio's objectForKey:"attachment"
      set chatName to "No chat attached"
      if attachment is not missing value and attachment is not current application's NSNull's null() then set chatName to attachment's objectForKey:"name"
      set entry to current application's NSMenuItem's alloc()'s initWithTitle:((partName as text) & " — " & (chatName as text) & " [" & (identity as text) & "]") action:"openRuntime:" keyEquivalent:""
      entry's setTarget:me
      entry's setRepresentedObject:identity
      runtimeMenu's addItem:entry
    end repeat
    runtimeItem's setEnabled:((runtimeMenu's numberOfItems()) > 0)
  on error
    updateItem's setHidden:true
    runtimeItem's setEnabled:false
  end try
end refreshMenu_
on menuNeedsUpdate_(sender)
  my refreshMenu_(sender)
end menuNeedsUpdate_

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
  set trayMenu to menu
  menu's setAutoenablesItems:false
  menu's setDelegate:me
  repeat with entry in {{"Open Studio", "openStudio:"}, {"Studios", ""}, {"New Instance", "newInstance:"}, {"Update", "updateApp:"}, {"Quit", "quitApp:"}}
    set menuItem to current application's NSMenuItem's alloc()'s initWithTitle:(item 1 of entry) action:(item 2 of entry) keyEquivalent:""
    menuItem's setTarget:me
    menu's addItem:menuItem
    if item 1 of entry is "Studios" then
      set runtimeItem to menuItem
      menuItem's setSubmenu:(current application's NSMenu's alloc()'s initWithTitle:"Studios")
    end if
    if item 1 of entry is "Update" then
      set updateItem to menuItem
      menuItem's setHidden:true
    end if
  end repeat
  statusItem's setMenu:menu
  current application's NSTimer's scheduledTimerWithTimeInterval:2 target:me selector:"refreshMenu:" userInfo:(missing value) repeats:true
  log "saam-tray-ready"
  app's run()
end run
