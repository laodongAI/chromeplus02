@echo off
rem ---------------------------------------------------------------
rem MediaPlus desktop annotation overlay launcher.
rem Double click to open the transparent drawing layer on the desktop.
rem Hotkeys: Ctrl+Alt+D draw/operate, Ctrl+Alt+T toolbar,
rem          Ctrl+Alt+Z undo, Ctrl+Alt+X clear, Ctrl+Alt+Q quit.
rem ---------------------------------------------------------------
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0overlay.ps1"
endlocal
