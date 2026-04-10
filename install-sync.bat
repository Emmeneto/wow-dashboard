@echo off
title WoW Dashboard - Install Auto-Sync
echo ========================================
echo   WoW Dashboard - Auto-Sync Setup
echo ========================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed! Download from https://nodejs.org/
    pause
    exit /b 1
)

:: Install dependencies
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    echo.
)

:: Run initial upload
echo Running initial sync...
node upload.js
echo.

:: Create startup shortcut
echo Installing auto-sync to Windows startup...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_PATH=%~dp0sync-silent.vbs"

:: Create a shortcut in the Startup folder
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTUP%\WoWDashboard-Sync.lnk'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%VBS_PATH%\"'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'WoW Dashboard Auto-Sync'; $s.Save()"

echo.
echo ========================================
echo   Setup complete!
echo ========================================
echo.
echo Auto-sync will now run silently every time
echo you start Windows. No terminal window needed.
echo.
echo To stop auto-sync: delete the shortcut from
echo   %STARTUP%\WoWDashboard-Sync.lnk
echo.
echo Starting sync now...
echo.
wscript.exe "%VBS_PATH%"
echo Sync is running in the background!
echo You can close this window.
echo.
pause
