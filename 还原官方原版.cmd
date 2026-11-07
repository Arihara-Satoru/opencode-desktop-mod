@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto :no_node

node "%~dp0apply-mod.mjs" --restore
if errorlevel 1 goto :restore_fail

echo.
pause
exit /b 0

:no_node
echo.
echo [Error] Node.js was not found.
echo Download Node.js from https://nodejs.org/
echo.
pause
exit /b 1

:restore_fail
echo.
echo [Failed] Restore failed. See the error above.
echo [EBUSY] Please fully exit OpenCode Desktop, then try again.
echo.
pause
exit /b 1
