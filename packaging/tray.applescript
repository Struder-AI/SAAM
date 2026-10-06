use AppleScript version "2.4"
use framework "AppKit"
use framework "Foundation"
use scripting additions
property statusItem : missing value
property controlPort : missing value
property controlToken : missing value
property trayMenu : missing value
property updateItem : missing value
property runtimeItem : missing value
property raiseScript : missing value

on callControl(commandName, forceQuit)
  return my sendControl("{\"command\":\"" & commandName & "\",\"force\":" & forceQuit & "}")
end callControl
-- The request waits while SAAM works on it, such as an open that starts a runtime;
-- SAAM's failure answer (ok false) or curl's connection error is raised to the caller.
on sendControl(payload)
  set resultText to do shell script "/usr/bin/curl --silent --show-error -H " & quoted form of ("X-SAAM-Control: " & controlToken) & " -H 'Content-Type: application/json' --data " & quoted form of payload & " " & quoted form of ("http://127.0.0.1:" & controlPort & "/control")
  set resultData to (current application's NSString's stringWithString:resultText)'s dataUsingEncoding:(current application's NSUTF8StringEncoding)
  set controlReply to current application's NSJSONSerialization's JSONObjectWithData:resultData options:0 |error|:(missing value)
  if controlReply is not missing value then
    set succeeded to controlReply's objectForKey:"ok"
    if succeeded is not missing value and not (succeeded's boolValue()) then error ((controlReply's objectForKey:"error") as text)
  end if
  return resultText
end sendControl
-- A confirmation lists each running job with its runtime, activity and duration.
on confirmationText(responseText)
  set responseData to (current application's NSString's stringWithString:responseText)'s dataUsingEncoding:(current application's NSUTF8StringEncoding)
  set parsed to current application's NSJSONSerialization's JSONObjectWithData:responseData options:0 |error|:(missing value)
  if parsed is missing value then return missing value
  set required to parsed's objectForKey:"confirmationRequired"
  if required is missing value or required is current application's NSNull's |null|() then return missing value
  if not (required's boolValue()) then return missing value
  return (parsed's objectForKey:"message") as text
end confirmationText

-- A click opens Studio and this process, which received it, shows the window
-- SAAM answers (studio/browser.mjs showOpened does the same for a launch).
on showStudio(payload)
  set openText to my sendControl(payload)
  set openData to (current application's NSString's stringWithString:openText)'s dataUsingEncoding:(current application's NSUTF8StringEncoding)
  set openReply to current application's NSJSONSerialization's JSONObjectWithData:openData options:0 |error|:(missing value)
  set studioAddress to (openReply's objectForKey:"url") as text
  set shownAs to openReply's objectForKey:"display"
  if shownAs is missing value or shownAs is current application's NSNull's |null|() then return
  set shownAs to shownAs as text
  if shownAs is "raise" then
    try
      if (do shell script "/usr/bin/osascript -l JavaScript " & quoted form of raiseScript & " " & quoted form of studioAddress) is not "not-found" then return
    end try
  end if
  if shownAs is "raise" or shownAs is "open" then do shell script "/usr/bin/open " & quoted form of studioAddress
end showStudio

on newInstance_(sender)
  try
    my showStudio("{\"command\":\"new-instance\",\"display\":\"caller\"}")
  on error problem
    display alert "SAAM" message problem
  end try
end newInstance_
on openRuntime_(sender)
  try
    -- The application supplies hexadecimal Studio identities, never shell code.
    my showStudio("{\"command\":\"open\",\"display\":\"caller\",\"studioInstanceId\":\"" & (sender's representedObject() as text) & "\"}")
  on error problem
    display alert "SAAM" message problem
  end try
end openRuntime_
on openSelectedRuntime_(sender)
  try
    my showStudio("{\"command\":\"open\",\"display\":\"caller\",\"runtimeId\":\"" & (sender's representedObject() as text) & "\"}")
  on error problem
    display alert "SAAM" message problem
  end try
end openSelectedRuntime_
on stopSelectedRuntime_(sender)
  try
    set identity to sender's representedObject() as text
    set responseText to my sendControl("{\"command\":\"stop-runtime\",\"runtimeId\":\"" & identity & "\"}")
    set jobPrompt to my confirmationText(responseText)
    if jobPrompt is not missing value then
      display dialog (jobPrompt & return & "Continue?") buttons {"Cancel", "Stop"} default button "Cancel"
      my sendControl("{\"command\":\"stop-runtime\",\"runtimeId\":\"" & identity & "\",\"force\":true}")
    end if
  on error problem number errorNumber
    if errorNumber is not -128 then display alert "SAAM" message problem
  end try
end stopSelectedRuntime_
on refreshMenu_(sender)
  try
    set statusText to my callControl("status", "false")
    set statusData to (current application's NSString's stringWithString:statusText)'s dataUsingEncoding:(current application's NSUTF8StringEncoding)
    set appStatus to current application's NSJSONSerialization's JSONObjectWithData:statusData options:0 |error|:(missing value)
    set serviceStatus to appStatus's objectForKey:"service"
    set paired to (serviceStatus's objectForKey:"activated")'s boolValue()
    set offer to serviceStatus's objectForKey:"update"
    updateItem's setHidden:(not (paired and offer is not missing value and offer is not current application's NSNull's |null|()))
    set runtimeMenu to runtimeItem's submenu()
    runtimeMenu's removeAllItems()
    set runtimeList to appStatus's objectForKey:"runtimes"
    set studioList to appStatus's objectForKey:"studios"
    repeat with runtimeIndex from 0 to ((runtimeList's |count|()) - 1)
      set runtime to runtimeList's objectAtIndex:runtimeIndex
      set runtimeId to runtime's objectForKey:"id"
      set runtimeEntry to current application's NSMenuItem's alloc()'s initWithTitle:(runtime's objectForKey:"label") action:"" keyEquivalent:""
      set children to current application's NSMenu's alloc()'s initWithTitle:"Runtime"
      children's setAutoenablesItems:false
      runtimeEntry's setSubmenu:children
      runtimeMenu's addItem:runtimeEntry
      set showItem to current application's NSMenuItem's alloc()'s initWithTitle:"Open Studio" action:"openSelectedRuntime:" keyEquivalent:""
      showItem's setTarget:me
      showItem's setRepresentedObject:runtimeId
      children's addItem:showItem
      repeat with studioIndex from 0 to ((studioList's |count|()) - 1)
        set studio to studioList's objectAtIndex:studioIndex
        if (studio's objectForKey:"runtimeId") as text is runtimeId as text then
          set identity to studio's objectForKey:"instanceId"
          set partName to studio's objectForKey:"printId"
          if partName is missing value or partName is current application's NSNull's |null|() then set partName to "Empty Studio"
          set chatAttachment to studio's objectForKey:"attachment"
          set chatName to "No chat attached"
          if chatAttachment is not missing value and chatAttachment is not current application's NSNull's |null|() then set chatName to chatAttachment's objectForKey:"name"
          set studioEntry to current application's NSMenuItem's alloc()'s initWithTitle:((partName as text) & " — " & (chatName as text) & " [" & (identity as text) & "]") action:"openRuntime:" keyEquivalent:""
          studioEntry's setTarget:me
          studioEntry's setRepresentedObject:identity
          children's addItem:studioEntry
        end if
      end repeat
      if runtimeId as text is not "installed" then
        set stopItem to current application's NSMenuItem's alloc()'s initWithTitle:"Stop runtime" action:"stopSelectedRuntime:" keyEquivalent:""
        stopItem's setTarget:me
        stopItem's setRepresentedObject:runtimeId
        children's addItem:stopItem
      end if
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
    my showStudio("{\"command\":\"open\",\"display\":\"caller\"}")
  on error problem
    display alert "SAAM" message problem
  end try
end openStudio_
on updateApp_(sender)
  try
    set responseText to my callControl("update", "false")
    set jobPrompt to my confirmationText(responseText)
    if jobPrompt is not missing value then
      display dialog (jobPrompt & return & "Continue?") buttons {"Cancel", "Update"} default button "Cancel"
      my callControl("update", "true")
    end if
  on error problem number errorNumber
    if errorNumber is not -128 then display alert "SAAM" message problem
  end try
end updateApp_
on quitApp_(sender)
  try
    set responseText to my callControl("quit", "false")
    set jobPrompt to my confirmationText(responseText)
    if jobPrompt is not missing value then
      display dialog jobPrompt buttons {"Cancel", "Quit"} default button "Cancel"
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
  set raiseScript to item 4 of argv
  -- AppleScript terms (app, run, count, null, button) are not variable names; Cocoa methods with those names are piped.
  set sharedApp to current application's NSApplication's sharedApplication()
  sharedApp's setActivationPolicy:(current application's NSApplicationActivationPolicyAccessory)
  set statusItem to current application's NSStatusBar's systemStatusBar()'s statusItemWithLength:(current application's NSVariableStatusItemLength)
  statusItem's |button|()'s setTitle:"SAAM"
  set trayMenu to current application's NSMenu's alloc()'s initWithTitle:"SAAM"
  trayMenu's setAutoenablesItems:false
  trayMenu's setDelegate:me
  repeat with menuEntry in {{"Open Studio", "openStudio:"}, {"Studios", ""}, {"New Instance", "newInstance:"}, {"Update", "updateApp:"}, {"Quit", "quitApp:"}}
    set entryTitle to item 1 of menuEntry
    set menuItem to current application's NSMenuItem's alloc()'s initWithTitle:entryTitle action:(item 2 of menuEntry) keyEquivalent:""
    menuItem's setTarget:me
    trayMenu's addItem:menuItem
    if entryTitle is "Studios" then
      set runtimeItem to menuItem
      menuItem's setSubmenu:(current application's NSMenu's alloc()'s initWithTitle:"Studios")
    end if
    if entryTitle is "Update" then
      set updateItem to menuItem
      menuItem's setHidden:true
    end if
  end repeat
  statusItem's setMenu:trayMenu
  current application's NSTimer's scheduledTimerWithTimeInterval:2 target:me selector:"refreshMenu:" userInfo:(missing value) repeats:true
  log "saam-tray-ready"
  sharedApp's |run|()
end run
