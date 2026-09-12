' Arranca el servidor de Pollito Casero sin ventana (lo usa el inicio automatico de Windows).
Set sh = CreateObject("WScript.Shell")
dir = Replace(WScript.ScriptFullName, WScript.ScriptName, "")
sh.CurrentDirectory = dir
sh.Run "cmd /c node server.mjs", 0, False
