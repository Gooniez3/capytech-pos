@echo off
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo CapyTech POS needs Node.js on this computer.
  echo Ask your installer to finish setup, then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo Backing up CapyTech POS...
echo.

node scripts\backup-shop.mjs
echo.
pause
