@echo off
setlocal
rem 用法：install.bat <扩展ID>
rem 扩展 ID 在 chrome://extensions 的 MediaPlus 卡片上查看（或设置面板复制）
if "%~1"=="" (
  echo 用法: install.bat ^<扩展ID^>
  echo 扩展 ID 可在 chrome://extensions 的 MediaPlus 卡片上查看
  exit /b 1
)
set EXTID=%~1
set HOSTNAME=com.chromeplus02.media
set DEST=%LOCALAPPDATA%\MediaPlusCompanion

echo [1/3] 复制文件到 %DEST% ...
xcopy /Y /I "%~dp0*" "%DEST%\" >nul

echo [2/3] 生成 host 清单（授权扩展 %EXTID%）...
> "%DEST%\%HOSTNAME%.json" (
  echo {
  echo   "name": "%HOSTNAME%",
  echo   "description": "MediaPlus 极速下载本地代理",
  echo   "path": "host.bat",
  echo   "type": "stdio",
  echo   "allowed_origins": ["chrome-extension://%EXTID%/"]
  echo }
)

echo [3/3] 注册注册表（当前用户）...
reg add HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOSTNAME% /ve /d "%DEST%\%HOSTNAME%.json" /f >nul

if not exist "%DEST%\bin\yt-dlp.exe" (
  echo.
  echo [提示] 未找到 %DEST%\bin\yt-dlp.exe
  echo        请从 https://github.com/yt-dlp/yt-dlp/releases 下载 yt-dlp.exe
  echo        放入 %DEST%\bin\ 目录
)

echo.
echo 安装完成。回到扩展「设置 → 极速下载」点击「重新检测」即可。
pause
