@echo off
chcp 65001 >nul
setlocal
echo ========================================================
echo  OpenCode 桌面端官方原版恢复工具
echo ========================================================
echo.

node -v >nul 2>&1
if %errorlevel% neq 0 (
  echo [错误] 未在当前系统中检测到 Node.js 环境！
  echo 请先前往官网下载安装 Node.js: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node "%~dp0apply-mod.mjs" --restore
if %errorlevel% neq 0 (
  echo.
  echo [失败] 恢复官方原版失败，请查看上方提示排查。
  echo 如提示文件被锁定 (EBUSY)，请先彻底退出 OpenCode 桌面端后再试。
  echo.
  pause
  exit /b 1
)

echo.
pause
