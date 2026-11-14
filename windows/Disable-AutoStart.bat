@echo off
title Disable TradeSync MT5 Windows Auto-Startup
schtasks /Delete /TN "TradeSyncMT5" /F
if errorlevel 1 (
    echo [INFO] Task not found or requires Administrator privileges.
) else (
    echo [OK] Auto-startup disabled.
)
pause
