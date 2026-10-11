@echo off
rem FALLBACK ONLY - use this if Yahoo blocks the server's address (see deploy\DEPLOY.md).
rem Your PC collects the data as before, then this pushes the finished database to the server.
rem Usage:   deploy\push-to-server.bat  <server-tailscale-name-or-ip>      e.g.  deploy\push-to-server.bat mstr-server
if "%~1"=="" (echo Usage: push-to-server.bat ^<server name or IP^> & exit /b 1)
cd /d "%~dp0\.."
set PY=%LOCALAPPDATA%\Python\pythoncore-3.15-64\python.exe
if not exist "%PY%" set PY=python
echo [1/3] Refreshing data on this PC...
"%PY%" -I collector\run_all.py
echo [2/3] Exporting database...
"%PY%" -I deploy\make-package.py
echo [3/3] Uploading and importing on the server...
scp deploy\out\mstr_terminal.sql.gz root@%~1:/root/
ssh root@%~1 "zcat /root/mstr_terminal.sql.gz | mysql mstr_terminal && echo imported"
echo Done.
