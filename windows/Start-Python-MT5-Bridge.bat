@echo off
setlocal
title TradeSync MT5 - Free Python Direct-Login Bridge
cd /d "%~dp0\.."

where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python 3 is not installed. Download free Python from https://www.python.org/
    pause
    exit /b 1
)

python -c "import MetaTrader5" >nul 2>&1
if errorlevel 1 (
    echo Installing free official MetaTrader5 Python package...
    python -m pip install --upgrade MetaTrader5
)

echo.
echo ==============================================================
echo  TradeSync MT5 - Free Direct Login + Password + Server Bridge
echo ==============================================================
echo  This logs directly into your local MT5 terminal using the
echo  100%% free official MetaTrader5 package (zero paid APIs).
echo.
python windows\tradesync_mt5_python_bridge.py %*
pause
