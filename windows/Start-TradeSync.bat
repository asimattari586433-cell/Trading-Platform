@echo off
setlocal
title TradeSync MT5 Server Supervisor (http://127.0.0.1:3000)
cd /d "%~dp0\.."

if not exist "dist\index.html" (
    echo [INFO] Production build not found. Building now...
    call npm run build
)

if not exist "data" mkdir data
if not exist "data\vault" mkdir data\vault
if not exist "data\mt5-instances" mkdir data\mt5-instances

set HOST=127.0.0.1
set PORT=3000
set NODE_ENV=production

echo ==============================================================
echo   TradeSync MT5 Local Server Starting on http://127.0.0.1:3000
echo   Auto-recovery crash supervisor is ACTIVE (loopback-only).
echo ==============================================================
echo.

if /I NOT "%~1"=="--headless" (
    start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:3000"
)

:supervisor_loop
echo [%DATE% %TIME%] Starting TradeSync MT5 backend...>> data\supervisor.log
if exist "node_modules\.bin\tsx.cmd" (
    call node_modules\.bin\tsx.cmd server.ts
) else (
    node server.ts
)
set EXIT_CODE=%ERRORLEVEL%
echo [%DATE% %TIME%] TradeSync MT5 exited with code %EXIT_CODE%. Restarting in 3 seconds...>> data\supervisor.log
echo [WARN] Backend exited (code %EXIT_CODE%). Restarting automatically in 3 seconds...
timeout /t 3 /nobreak >nul
goto supervisor_loop
