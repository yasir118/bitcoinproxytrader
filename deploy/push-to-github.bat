@echo off
rem Sends the project to your (empty) GitHub repository. Run it once; after that GitHub updates the website by itself every day.
cd /d "%~dp0\.."
echo.
echo Paste the address of your EMPTY GitHub repository.
echo It looks like:  https://github.com/YOURNAME/bitcoinproxytrader.git
echo.
set /p REPO=Repository address:
if "%REPO%"=="" (echo No address entered. & pause & exit /b 1)
git init -b main
rem identity used for the commit: a no-reply address, so your real email is never published
git config user.name "BitcoinProxyTrader"
git config user.email "noreply@users.noreply.github.com"
git add -A
git commit -m "BitcoinProxyTrader"
git remote remove origin >nul 2>&1
git remote add origin %REPO%
echo.
echo Pushing... a browser window may open asking you to sign in to GitHub - approve it.
git push -u origin main
echo.
echo Done. Next: on GitHub open  Settings ^> Pages ^> Build and deployment ^> Source  and choose "GitHub Actions".
echo Then open the "Actions" tab and press "Run workflow" on "Daily update".
pause
