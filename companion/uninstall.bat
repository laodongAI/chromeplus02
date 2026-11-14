@echo off
rem MediaPlus companion uninstaller.
rem IMPORTANT: keep this file pure ASCII with CRLF line endings
rem (cmd.exe OEM code page parsing; Chinese docs are in README.md).
set HOSTNAME=com.chromeplus02.media
reg delete HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOSTNAME% /f >nul 2>&1
rd /s /q "%LOCALAPPDATA%\MediaPlusCompanion" 2>nul
echo MediaPlus companion uninstalled.
pause
