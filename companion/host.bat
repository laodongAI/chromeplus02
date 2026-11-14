@echo off
rem MediaPlus Native Messaging Host launcher (companion).
rem IMPORTANT: this file MUST stay pure ASCII with CRLF line endings.
rem   cmd.exe parses .bat files using the OEM code page; UTF-8 Chinese
rem   text or LF-only line endings corrupt the parse and kill the host
rem   at launch (symptom: extension reports "companion not responding").
rem   Chinese documentation lives in README.md and host.ps1 header comments.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0host.ps1"
