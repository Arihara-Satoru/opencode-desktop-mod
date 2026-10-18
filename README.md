# OpenCode Desktop Timeline, /btw Companion & Branch Mod

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/Arihara-Satoru/opencode-desktop-mod)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green)](https://nodejs.org/)
[![OpenCode](https://img.shields.io/badge/OpenCode%20Desktop-v2.0.32%2B-purple)](https://opencode.ai)

**专为 OpenCode Desktop (Electron 桌面端) 深度定制的交互体验增强套件**

[✨ 特性介绍](#-特性概览) • [🚀 快速安装](#-快速安装) • [🔄 一键还原](#-一键还原) • [🛡️ 安全透明](#️-安全与隐私承诺) • [❓ 常见问题](#-常见问题-faq)

</div>

---

> 🎯 **三大核心增强**：
> 1. **左侧极简时间轴导航条 (ChatGPT / Codex 风格悬浮游标)**：丝滑跳转任意轮次与 Markdown 小标题，解决长对话翻找痛点；
> 2. **右侧升级版 `/btw` 多轮伴侣问答面板**：支持 60 FPS 自适应打字机流式输出、独立模型切换、划词引用与多标签持久化；
> 3. **每轮回复分支到新聊天 (Codex 风格一键分支)**：助手回答底栏直出分支按钮，自动截取上下文并智能递增编号命名。

---

## 🌟 特性概览

```text
┌─────────────────┬──────────────────────────────────────────┬──────────────────────┐
│  左侧极简时间轴   │               主对话工作区                │   右侧 /btw 伴侣面板   │
│                 │                                          │                      │
│  — #1 提问      │  User: ...                               │  [💬 讨论 1 ×] [+]   │
│  — #2 方案      │  Assistant: ...                          │                      │
│  —   ├ 设计思路  │                                          │  > [引用第 2 轮]     │
│  —   └ 代码实现  │  [复制] [分支到新聊天]                     │  针对方案的细化答疑... │
│  — #3 优化      │  User: ...                               │  (自适应打字机输出▋) │
│                 │                                          │                      │
│  (鼠标靠近展开   │  (支持划词浮现「引用到 /btw」Alt+Q)         │  [选择模型 ▼] [仅当前]│
│   动态鱼眼与预览)│                                          │  [输入伴侣消息...]    │
└─────────────────┴──────────────────────────────────────────┴──────────────────────┘
```

### 1. 左侧会话时间轴导航条 (Timeline Scrubber)
- **极简隐形刻度尺**：借鉴 ChatGPT / Codex 悬浮时间轴，在主对话区左缘以极细水平刻线（`—`）呈现，不挤占对话宽度、不产生视觉干扰。
- **动态高斯鱼眼波浪**：鼠标掠过时刻度线呈平滑波浪展开，指引清晰自然。
- **懒加载悬浮预览卡片**：
  - 鼠标悬浮在刻度线上即时展示该轮提问序号、标题与内容摘要。
  - 自动解析该轮 AI 回答内的 Markdown `H1` / `H2` / `H3` 小标题目录并生成可点击树形跳转列表。
- **100% 丝滑减速滚动 (Cubic Ease-Out)**：
  - 针对 OpenCode 虚拟滚动列表（`@tanstack/virtual-core`）深度适配。
  - 直接提取虚拟列表底层像素偏移，彻底消除跨屏远距离跳转时原生虚拟列表强制瞬移闪烁或中途被打断的问题。
- **本地持久化索引缓存**：
  - 历史目录索引缓存至本地存储（`localStorage`），秒开秒出；支持平滑跳转任意早期历史轮次。

### 2. 右侧 `/btw` 伴侣问答面板 (Companion Chat)
官方原版 `/btw` 功能较为局限（每次问答都会强制捆绑发送当前主会话的完整历史、无法自由挑选模型、关闭即丢）。本增强补丁将其升级为完整的侧栏伴侣：
- **平滑自适应 60 FPS 打字机流式输出（Fluid Typewriter Engine）**：
  - 基于隔离的瞬态子会话（`ses_btw_*`）驱动，通过实时事件流与打字机缓冲池逐字流出。
  - 彻底消除网络包与模型分块导致的“文字一块一块弹出来”的突兀感，以人眼最舒适的匀速与自适应调速（1~3 字/帧）平滑显现。
  - 深度接入官方原生增量流式 Markdown 渲染管线，并配有动态呼吸打字光标（`▋`）。
  - 支持中途随时停止生成并完整保留已输出内容；支持失败自动重试熔断与友好报错提示。
- **多标签页对话（Native Tab Strip）**：
  - 顶部原生水平标签页设计（`[💬 标题 ×] +`），支持多话题并行提问与自由切换。
- **多模态图片输入与预览**：
  - 支持 **`Ctrl + V` 剪贴板粘贴截图**、**文件拖拽**、**左下角 `+` 按钮**添加多张图片。
  - 输入框内置图片缩略卡片，发送前/发送后均支持点击放大 Lightbox 预览。
- **独立模型自由选择**：自动加载当前可用的模型列表，可随意选择高速便宜模型（如 MiniMax / DeepSeek / Claude 等）进行辅助问答，完全独立于主会话。
- **灵活的上下文控制**：
  - ⚡ **仅引用/当前**（默认）：不携带主会话历史，杜绝 Token 浪费与干扰，专注解答当前问题。
  - 🔗 **最近 3 轮**：注入最近几轮核心交互，理解上下文背景。
  - 📚 **完整主会话**：向模型提供主会话完整记录。
- **划词一键引用 / 解释**：
  - 在主对话区任意选中文字，弹出极简悬浮胶囊：`引用到 /btw` 或 `⚡ 解释`（快捷键：`Alt+Q`）。
- **持久化连续多轮对话**：
  - 面板关闭或重启客户端不丢失对话记录，并支持一键清空重置。

### 3. 会话分支到新聊天 (Branch to New Chat)
对标 OpenAI Codex 客户端的分支功能，在主对话区每一条助手回答底部的复制按钮旁新增**分支图标按钮**（悬停提示“分支到新聊天”）：
- **节点级会话克隆**：
  - 无论处于长对话的哪一轮，点击该轮回答底部的分支按钮，系统将自动截取并复制**截止至该轮回答**的全部历史到新会话中。
- **智能多分支命名与递增编号**：
  - 首次分支自动将新会话标题命名为 `原标题 (分支)`。
  - 多次分支或在已有分支会话上再次分支时，智能检测当前全部会话，自动按序号递增标注（如 `原标题 (分支 2)`、`原标题 (分支 3)`），各分支清晰独立。
- **丝滑切换 + 干净就绪**：
  - 瞬间完成服务端会话创建与本地缓存同步，无感自动跳转至新会话。

---

## 🚀 快速安装

### 前置要求
- 已安装并使用 **OpenCode Desktop (建议 v2.0.32+)**
- 系统已安装 **Node.js** (v18+)

---

### 1. Windows 用户安装

1. 克隆或下载本仓库到本地任意目录：
   ```bash
   git clone https://github.com/Arihara-Satoru/opencode-desktop-mod.git
   cd opencode-desktop-mod
   ```
2. **完全关闭 OpenCode 桌面端**（防止文件被 Windows 系统占用）。
3. 双击运行 **`应用桌面端补丁.cmd`**（或在终端执行 `node apply-mod.mjs`）。
4. 提示成功后，重新启动 OpenCode 桌面端即可！

---

### 2. macOS / Linux 用户安装

1. 克隆本仓库：
   ```bash
   git clone https://github.com/Arihara-Satoru/opencode-desktop-mod.git
   cd opencode-desktop-mod
   ```
2. **完全退出 OpenCode 桌面端**。
3. 在终端中运行：
   ```bash
   chmod +x apply-mod.sh restore.sh
   ./apply-mod.sh
   ```
   *(或直接执行 `node apply-mod.mjs`)*
4. 重启 OpenCode 桌面端即可生效！

---

## 🔄 一键还原

如果想随时彻底恢复官方原始界面：
- **Windows**：双击运行 **`还原官方原版.cmd`**（或终端执行 `node apply-mod.mjs --restore`）。
- **macOS / Linux**：终端执行 **`./restore.sh`**（或 `node apply-mod.mjs --restore`）。
- 然后重启 OpenCode 即可完全恢复如初。

---

## ⚙️ 快捷键速查

| 快捷键 | 功能 | 说明 |
| :--- | :--- | :--- |
| `Alt + B` | 开关右侧 `/btw` 伴侣问答面板 | 任意时刻快速唤出或收起 |
| `Alt + Q` | 引用所选文字至 `/btw` | 在主对话区选中文字后直接引用并聚焦输入框 |
| `Enter` | 发送消息 | 在 `/btw` 输入框中发送 |
| `Shift + Enter` | 换行 | 在 `/btw` 输入框中插入换行 |

---

## 🛡️ 安全与隐私承诺

- **100% 离线纯本地运行**：补丁仅对客户端本地 Electron 资源文件进行注入，**不包含任何远程外联代码、不收集任何遥测数据、不上传任何信息**。
- **保护用户隐私与凭据**：完全不接触你的模型密钥、会话记录、环境凭证或账号数据。
- **自动安全备份与智能更新**：
  - 首次注入时自动生成官方原版 `app.asar.bak`。
  - 遇到 OpenCode 官方版本自动更新时，脚本具有版本感知能力，会自动基于官方新版本刷新备份，**绝不会将新版本客户端恶意覆盖或降级**。
- **随时 100% 干净回滚**：执行 restore 命令即可一键恢复官方原包，不残留任何修改。

---

## ❓ 常见问题 (FAQ)

### Q1: OpenCode 官方发布新版本更新后，补丁失效了怎么办？
**答**：退出 OpenCode，重新运行一次 `应用桌面端补丁.cmd`（或 `./apply-mod.sh`）即可！  
补丁工具会自动识别新版本并刷新基准备份，再次安全应用增强。

### Q2: 提示“检测到 OpenCode 桌面端正在运行 (EBUSY)”？
**答**：Windows / macOS 系统对正在运行的程序资源文件拥有独占文件锁。请彻底关闭 OpenCode（或在任务管理器中结束 OpenCode 进程）后再运行注入脚本。

### Q3: 我的 OpenCode 安装在自定义非标准路径？
**答**：脚本会自动检索默认安装路径。若你的客户端位于自定义目录，可通过环境变量指定路径：
- **Windows (PowerShell)**:
  ```powershell
  $env:OPENCODE_ASAR_PATH="D:\Softwares\OpenCode\resources\app.asar"
  node apply-mod.mjs
  ```
- **Windows (CMD)**:
  ```cmd
  set OPENCODE_ASAR_PATH=D:\Softwares\OpenCode\resources\app.asar && node apply-mod.mjs
  ```
- **macOS / Linux**:
  ```bash
  OPENCODE_ASAR_PATH="/custom/path/app.asar" node apply-mod.mjs
  ```

---

## 🛠️ 技术原理与架构

- **零破坏追加式 ASAR 打包算法**：
  保留 Electron `app.asar` 头部原有文件的对齐偏移不变，将增强后的模块追加写入 Payload 尾部，更新索引表与 SHA-256 块校验和。升级与还原无缝衔接。
- **虚拟列表与平滑缓动协同**：
  - 拦截 OpenCode 的虚拟列表控制器 `__oc_timeline_ctrl` 与实例 `__oc_virtual_scroll`。
  - 在滚动开始前同步解除自动吸底锁定（`unpin()`），并前置刷新高度补偿状态（`be()`）。
  - 利用自相似三次缓动公式 `currentPos += (destTop - currentPos) * (1 - (remTime / duration)^3)` 实时追踪动态加载的 DOM 节点，保障全链路 60 FPS 平滑滚动。

---

## 📄 开源许可

本项目基于 [MIT License](LICENSE) 开源。欢迎提交 Issue 与 Pull Request 共同改进！
