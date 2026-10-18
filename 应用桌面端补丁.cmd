@echo off
chcp 65001 >nul
echo 正在为 OpenCode 桌面端注入「左侧时间轴 + 增强版 /btw 问答 + 回复分支到新会话」补丁...
node "%~dp0apply-mod.mjs"
echo.
echo 补丁已完成！请重启 OpenCode 桌面端窗口以生效。
pause
