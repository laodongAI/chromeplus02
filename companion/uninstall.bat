@echo off
set HOSTNAME=com.chromeplus02.media
reg delete HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOSTNAME% /f >nul 2>&1
rd /s /q "%LOCALAPPDATA%\MediaPlusCompanion" 2>nul
echo 已卸载 MediaPlus 伴生程序。
pause
