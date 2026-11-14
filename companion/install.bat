@echo off
setlocal
rem MediaPlus companion installer.
rem Usage: install.bat <extension-id>
rem The extension id is shown on the MediaPlus card at chrome://extensions.
rem IMPORTANT: keep this file pure ASCII with CRLF line endings
rem (cmd.exe OEM code page parsing; Chinese docs are in README.md).
if "%~1"=="" (
  echo Usage: install.bat ^<extension-id^>
  echo The extension id is shown on the MediaPlus card at chrome://extensions
  exit /b 1
)
set EXTID=%~1
set HOSTNAME=com.chromeplus02.media
set DEST=%LOCALAPPDATA%\MediaPlusCompanion

echo [1/3] Copying files to %DEST% ...
xcopy /Y /I /E "%~dp0*" "%DEST%\" >nul

echo [2/3] Writing host manifest (allowing extension %EXTID%)...
> "%DEST%\%HOSTNAME%.json" (
  echo {
  echo   "name": "%HOSTNAME%",
  echo   "description": "MediaPlus companion (fast download + desktop overlay)",
  echo   "path": "host.bat",
  echo   "type": "stdio",
  echo   "allowed_origins": ["chrome-extension://%EXTID%/"]
  echo }
)

echo [3/3] Registering native messaging host (current user)...
reg add HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOSTNAME% /ve /d "%DEST%\%HOSTNAME%.json" /f >nul

if not exist "%DEST%\bin\yt-dlp.exe" (
  echo.
  echo [NOTE] %DEST%\bin\yt-dlp.exe not found.
  echo        Fast download needs it: download yt-dlp.exe from
  echo        https://github.com/yt-dlp/yt-dlp/releases into %DEST%\bin\
  echo        Desktop overlay works without it.
)

echo.
echo Done. Go to the extension Settings page and click re-check.
pause
