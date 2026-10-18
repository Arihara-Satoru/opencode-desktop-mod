@echo off
chcp 65001 >nul
echo 正在从备份还原 OpenCode 桌面端原版 app.asar...
node "%~dp0apply-mod.mjs" --restore
echo.
echo 已还原为官方原版！请重启 OpenCode 桌面端窗口。
pause
