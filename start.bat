@echo off
title WoW Dashboard Companion
echo ========================================
echo   WoW Dashboard - Companion App
echo ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Download it from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    echo.
)

echo Starting WoW Dashboard server...
echo Dashboard will be available at: http://localhost:3000
echo.
echo Press Ctrl+C to stop the server.
echo ========================================
echo.

node server.js

pause
