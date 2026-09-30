' Starts SAAM from this installed version without a window: the SAAM
' shortcuts run this file with wscript.exe, and install.ps1 writes it here.
' Closing the Studio tab or Quit stops SAAM. SAAM.cmd starts it with a console window
' instead, for troubleshooting. Prints stay in %LOCALAPPDATA%\SAAM.
Option Explicit
Dim shell, here
Set shell = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
' Run from the home folder, so SAAM never holds the program folder open while
' an update replaces it.
shell.CurrentDirectory = shell.ExpandEnvironmentStrings("%USERPROFILE%")
' Window style 0 (hidden); do not wait for SAAM to exit.
shell.Run """" & here & "\runtime\node.exe"" """ & here & "\packaging\launch.mjs""", 0, False
