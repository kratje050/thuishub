@echo off
setlocal
cd /d "%~dp0"
title ThuisHub installeren

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is niet gevonden.
  echo Installeer Node.js 22 of nieuwer via https://nodejs.org en probeer opnieuw.
  pause
  exit /b 1
)

echo [1/2] Onderdelen installeren...
call npm install
if errorlevel 1 goto :error

echo.
echo [2/2] ThuisHub bouwen...
call npm run build
if errorlevel 1 goto :error

echo.
echo ThuisHub is klaar. Dubbelklik op "ThuisHub starten.cmd".
pause
exit /b 0

:error
echo.
echo De installatie is niet voltooid. Bekijk de fout hierboven.
pause
exit /b 1
