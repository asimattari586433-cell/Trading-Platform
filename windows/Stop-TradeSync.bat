@echo off
title Stop TradeSync MT5
echo Stopping TradeSync MT5 local server and supervisor...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Stopping Node process PID %%a on port 3000...
    taskkill /F /PID %%a >nul 2>nul
)

taskkill /F /FI "WINDOWTITLE eq TradeSync MT5 Server Supervisor*" >nul 2>nul

echo [OK] TradeSync MT5 stopped.
timeout /t 2 >nul
