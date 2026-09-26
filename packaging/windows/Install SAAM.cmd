@echo off
rem Installs SAAM for this Windows user. The execution policy is bypassed for
rem this one PowerShell process only; no system setting changes.
title Install SAAM
set "missing="
if not exist "%~dp0app.tar" set "missing=1"
if not exist "%~dp0app\packaging\windows\install.ps1" set "missing=1"
if defined missing (
  echo Part of the package is missing. Extract the whole ZIP first, then run "Install SAAM.cmd" from the extracted folder.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\packaging\windows\install.ps1"
set "status=%errorlevel%"
echo.
pause
exit /b %status%
