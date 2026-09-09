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
echo Starting CapyTech POS...
echo Leave this window open while you sell.
echo.

node scripts\start-pos.mjs
if errorlevel 1 (
  echo.
  pause
)
