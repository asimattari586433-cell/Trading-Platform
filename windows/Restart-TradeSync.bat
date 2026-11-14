@echo off
title Restart TradeSync MT5
echo Restarting TradeSync MT5...
call "%~dp0Stop-TradeSync.bat"
timeout /t 2 /nobreak >nul
start "TradeSync MT5 Server Supervisor" cmd /c "%~dp0Start-TradeSync.bat"
echo [OK] TradeSync MT5 restarted on http://localhost:3000
timeout /t 2 >nul
