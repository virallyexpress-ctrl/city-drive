@echo off
chcp 65001 >nul
title City Drive Server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org ^(LTS^), install, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing... ^(first time only^)
  call npm install
)
echo.
echo Game + server: http://localhost:8080
echo Leave this window open while playing. Close it to stop the server.
echo.
start "" http://localhost:8080
node server.js
pause
