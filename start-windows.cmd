@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 24.15 or newer is required. & exit /b 1)
call npm.cmd start
