@echo off
setlocal
title ResearchForge Launcher

cd /d "%~dp0"

echo Starting ResearchForge Backend...
start "ResearchForge Backend" /D "%~dp0backend" "%~dp0backend\venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

timeout /t 3 /nobreak >nul

echo Starting ResearchForge Frontend...
start "ResearchForge Frontend" /D "%~dp0" "%~dp0backend\venv\Scripts\python.exe" "%~dp0frontend\dev_server.py"

timeout /t 3 /nobreak >nul

echo Opening ResearchForge...
start "" "http://127.0.0.1:5500/index.html"

echo.
echo ResearchForge startup initiated.
echo Keep both server windows open.
echo.
pause

