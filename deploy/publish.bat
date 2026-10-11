@echo off
rem Collect fresh data, rebuild the public website, upload it. Needs XAMPP (Apache + MySQL) running.
cd /d "%~dp0\.."
set PY=%LOCALAPPDATA%\Python\pythoncore-3.15-64\python.exe
if not exist "%PY%" set PY=python
"%PY%" -I deploy\publish.py %*
pause
