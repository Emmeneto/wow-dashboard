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

:: Upload character data to the hosted dashboard
echo Uploading character data to hosted dashboard...
node upload.js
echo.

echo Starting local dashboard server...
echo Local dashboard: http://localhost:3000
echo.
echo Press Ctrl+C to stop.
echo ========================================
echo.

node server.js

pause
