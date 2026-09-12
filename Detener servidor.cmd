@echo off
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction Stop | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force; 'Servidor detenido.' } } catch { 'No habia servidor corriendo.' }"
pause
