@echo off
title Enable TradeSync MT5 Windows Auto-Startup
set SCRIPT_PATH=%~dp0Start-TradeSync.bat

echo Registering TradeSync MT5 in Windows Task Scheduler (headless logon mode)...
schtasks /Create /TN "TradeSyncMT5" /TR "\"%SCRIPT_PATH%\" --headless" /SC ONLOGON /RL HIGHEST /F
if errorlevel 1 (
    echo.
    echo [ERROR] Please right-click Enable-AutoStart.bat and choose "Run as administrator".
    pause
    exit /b 1
)

echo.
echo [OK] TradeSync MT5 will now start automatically in the background whenever Windows logs in!
pause
