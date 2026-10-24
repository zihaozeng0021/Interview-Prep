@echo off
setlocal
cd /d "%~dp0"

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo.
  echo [!] Python 3 was not found on this computer.
  echo     Install it from https://www.python.org/downloads/
  echo     and tick "Add python.exe to PATH" during setup, then run start.bat again.
  echo.
  pause
  exit /b 1
)

%PY% server.py %*
if errorlevel 1 pause
