@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 24.15 or newer is required. & exit /b 1)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>24||(a===24&&b>=15)?0:1)" || (echo Node.js 24.15 or newer is required. & exit /b 1)
if not exist .env (echo Run scripts\setup-windows.ps1 before starting the application. & exit /b 1)
call npm.cmd start
