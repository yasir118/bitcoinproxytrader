@echo off
rem Builds deploy\out\mstr-app.zip and deploy\out\mstr_terminal.sql.gz for the server. XAMPP MySQL must be running.
cd /d "%~dp0\.."
set PY=%LOCALAPPDATA%\Python\pythoncore-3.15-64\python.exe
if not exist "%PY%" set PY=python
"%PY%" -I deploy\make-package.py
pause
