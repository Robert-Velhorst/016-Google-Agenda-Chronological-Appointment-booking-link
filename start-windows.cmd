@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 26.12.0 or newer within Node 26 is required. & exit /b 1)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a===26&&b>=12?0:1)" || (echo Node.js 26.12.0 or newer within Node 26 is required. & exit /b 1)
if not exist .env (echo Run scripts\setup-windows.ps1 before starting the application. & exit /b 1)
call npm.cmd start
