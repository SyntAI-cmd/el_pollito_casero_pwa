@echo off
title Pollito Casero - servidor
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js 24. Instalalo desde https://nodejs.org y volve a abrir este archivo. & pause & exit /b 1)
if not exist node_modules call npm install
if not exist dist\index.html call npm run build
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo El servidor ya esta corriendo. Abriendo http://localhost:5173 ...
  start "" http://localhost:5173
  timeout /t 3 >nul
  exit /b 0
)
start "" http://localhost:5173
echo.
echo  Pollito Casero corriendo en http://localhost:5173
echo  Dejá esta ventana abierta mientras uses la app (o instala el inicio automatico).
echo.
node server.mjs
pause
