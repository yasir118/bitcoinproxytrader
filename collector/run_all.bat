@echo off
rem BitcoinProxyTrader - run the whole collection + analytics pipeline (incremental).
rem Schedule this after the US close (about 4:15 pm New York time), see README.md.
cd /d "%~dp0"
set PY=%LOCALAPPDATA%\Python\pythoncore-3.15-64\python.exe
if not exist "%PY%" set PY=python
"%PY%" -I run_all.py %* >> logs\scheduled.log 2>&1
