@echo off
rem Starts SAAM from this installed version. Keep the window open while you use
rem SAAM; closing it stops SAAM. Prints stay in %LOCALAPPDATA%\SAAM.
title SAAM - close this window to stop SAAM
rem Run from the home folder, so this window never holds the program folder
rem open while an update replaces it.
cd /d "%USERPROFILE%"
"%~dp0runtime\node.exe" "%~dp0packaging\launch.mjs"
if errorlevel 1 (
  echo.
  echo SAAM stopped with an error. Its log is in %LOCALAPPDATA%\SAAM\logs.
  pause
)
