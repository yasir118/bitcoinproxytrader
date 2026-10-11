@echo off
rem First-time setup: installs the one dependency, creates the database + tables, then downloads everything.
cd /d "%~dp0"
set PY=%LOCALAPPDATA%\Python\pythoncore-3.15-64\python.exe
if not exist "%PY%" set PY=python
"%PY%" -m pip install -r requirements.txt
"%PY%" -I run_all.py --full
echo.
echo Done. Open http://localhost/cc/MSTR/
pause
