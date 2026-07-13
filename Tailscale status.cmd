@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tailscale-serve.ps1" status
pause
