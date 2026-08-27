@echo off
title VANT YT Downloader
cd /d "%~dp0"

echo Starting VANT YT Downloader...

py main.py
if %errorlevel% neq 0 (
    python main.py
)
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to start VANT YT Downloader.
    echo Please make sure Python 3.10+ and required packages are installed:
    echo pip install -r requirements.txt
    echo.
    pause
)
