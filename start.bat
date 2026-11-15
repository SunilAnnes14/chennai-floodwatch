@echo off
REM Double-click this file to start Chennai FloodWatch.
REM It opens two windows: one for the backend, one for the website.

cd /d "%~dp0"

REM ---- First-time setup (only runs if something is missing) ----
if not exist backend\.venv (
    echo Creating Python environment...
    python -m venv backend\.venv
)
if not exist backend\.venv\Lib\site-packages\fastapi (
    echo Installing Python packages...
    backend\.venv\Scripts\python -m pip install -r backend\requirements.txt
)
if not exist backend\.env (
    copy backend\.env.example backend\.env >nul
    echo Created backend\.env - remember to change JWT_SECRET inside it.
)
if not exist frontend\node_modules (
    echo Installing website packages...
    cd frontend
    call npm install
    cd ..
)

REM ---- Start both servers ----
start "FloodWatch BACKEND (keep open)" cmd /k "cd /d %~dp0backend && .venv\Scripts\python -m uvicorn main:app --reload"
start "FloodWatch WEBSITE (keep open)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Starting... the website will open in your browser in a few seconds.
timeout /t 6 >nul
start http://localhost:5173
