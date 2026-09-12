@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Pollito Casero servidor.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0servidor-oculto.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Description='Servidor local de Pollito Casero'; $s.Save()"
wscript.exe "%~dp0servidor-oculto.vbs"
echo Listo: el servidor arranca solo al iniciar sesion en Windows y ya quedo corriendo ahora.
echo Para desinstalarlo, borra "Pollito Casero servidor" de la carpeta Inicio (shell:startup).
pause
