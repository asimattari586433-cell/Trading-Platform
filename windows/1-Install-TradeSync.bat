@echo off
setlocal enabledelayedexpansion
title TradeSync MT5 - One-Click Windows Installer
cd /d "%~dp0\.."

if /I "%~1"=="/cli" goto :cli_install

where powershell >nul 2>nul
if not errorlevel 1 (
    if exist "%~dp0TradeSync-Setup-Wizard.ps1" (
        echo Launching TradeSync MT5 Graphical Setup Wizard...
        powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0TradeSync-Setup-Wizard.ps1"
        exit /b %ERRORLEVEL%
    )
)

:cli_install
echo ==============================================================
echo   TradeSync MT5 - Local Windows PC/Laptop Installer
echo ==============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    echo Please install Node.js 22 LTS from https://nodejs.org/ and re-run this script.
    pause
    exit /b 1
)

for /f "tokens=1" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Detected Node.js %NODE_VER%

if not exist ".env" (
    echo PORT=3000> .env
    echo NODE_ENV=production>> .env
    echo [OK] Created local .env configuration on port 3000
)

if not exist "data" mkdir data
if not exist "data\vault" mkdir data\vault
if not exist "data\mt5-instances" mkdir data\mt5-instances

echo.
echo [1/3] Installing npm packages...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed. Check your internet connection and retry.
    pause
    exit /b 1
)

echo.
echo [2/3] Building TradeSync MT5 frontend bundle...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Creating Start Menu & Desktop shortcuts...
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell); $d=[Environment]::GetFolderPath('Desktop'); $sc=$s.CreateShortcut((Join-Path $d 'TradeSync MT5.lnk')); $sc.TargetPath='%~dp0Start-TradeSync.bat'; $sc.WorkingDirectory='%CD%'; $sc.Save()" >nul 2>nul

echo.
echo ==============================================================
echo   Installation Complete!
echo   - Run windows\Start-TradeSync.bat to launch & open http://localhost:3000
echo   - Optional: Run windows\Enable-AutoStart.bat as Administrator
echo ==============================================================
echo.
pause
