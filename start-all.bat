@echo off
rem Fast start: app restarts, engines reused if already up. Use start-all.bat clean to also restart engines.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-all.ps1" %*
pause
