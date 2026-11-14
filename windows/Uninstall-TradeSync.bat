@echo off
setlocal
title Uninstall TradeSync MT5
cd /d "%~dp0\.."

echo ==============================================================
echo   TradeSync MT5 - Clean Uninstaller
echo ==============================================================
echo.

echo [1/4] Stopping running TradeSync MT5 server...
call "%~dp0Stop-TradeSync.bat" >nul 2>nul

echo [2/4] Removing Windows Task Scheduler auto-start (if registered)...
schtasks /Delete /TN "TradeSyncMT5" /F >nul 2>nul

echo [3/4] Removing Desktop & Start Menu shortcuts...
powershell -NoProfile -Command "$d=[Environment]::GetFolderPath('Desktop'); Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $d 'TradeSync MT5.lnk'); $sm=Join-Path ([Environment]::GetFolderPath('Programs')) 'TradeSync MT5'; if(Test-Path $sm){ Remove-Item -Recurse -Force $sm }"

echo [4/4] Data cleanup option:
set /p WIPE="Delete saved accounts, copier rules, DPAPI vault, and MT5 instances in data\? (y/N): "
if /I "%WIPE%"=="y" (
    rmdir /s /q data >nul 2>nul
    echo [OK] Local data\, vault\, and mt5-instances\ deleted.
) else (
    echo [INFO] Preserved data\ folder for future reinstall or migration.
)

echo.
echo Uninstall cleanup complete. You can now delete the remaining TradeSync folder if desired.
pause
