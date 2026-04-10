@echo off
title WoW Dashboard - Auto-Sync
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed! Download from https://nodejs.org/
    pause
    exit /b 1
)
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
)
node sync.js
pause
