@echo off
rem Starts SAAM from this installed version with a console window, for
rem troubleshooting (Start Menu "SAAM (with console)"): the SAAM shortcuts start
rem it without one (SAAM.vbs). Quit in SAAM Studio or close this window to stop
rem SAAM. Prints stay in C:\SAAM\Prints.
title SAAM - close this window to stop SAAM
rem Run from the home folder, so this window never holds the program folder
rem open while an update replaces it.
cd /d "%USERPROFILE%"
"%~dp0runtime\node.exe" "%~dp0packaging\launch.mjs"
if errorlevel 1 (
  echo.
  echo SAAM stopped with an error. Its log is in C:\SAAM\state\logs.
  pause
)
