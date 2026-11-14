@echo off
setlocal
title TradeSync MT5 - Safe In-Place Updater
cd /d "%~dp0\.."

echo ==============================================================
echo   TradeSync MT5 - Updater (Preserves data\, vault\ & .env)
echo ==============================================================
echo.

call "%~dp0Stop-TradeSync.bat" >nul 2>nul

echo [1/2] Updating npm dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)

echo [2/2] Rebuilding TradeSync MT5 dashboard bundle...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo [OK] Update complete! Your accounts, rules, DPAPI vault, and MT5 instances were preserved.
echo Starting TradeSync MT5...
start "" "%~dp0Start-TradeSync.bat"
