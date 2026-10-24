@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto :no_node

node "%~dp0apply-mod.mjs" %*
if errorlevel 1 goto :mod_fail

echo.
pause
exit /b 0

:no_node
echo.
echo [错误] 未在当前系统中检测到 Node.js 环境！
echo 本补丁注入脚本依赖 Node.js v18 或更高版本。
echo 请先前往官网下载安装 Node.js: https://nodejs.org/
echo.
pause
exit /b 1

:mod_fail
echo.
echo [失败] 补丁注入过程中遇到错误，请查看上方提示排查。
echo 如提示文件被锁定 (EBUSY)，请先彻底退出 OpenCode 桌面端后再试。
echo.
pause
exit /b 1
