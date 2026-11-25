import { BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { EDIT_SCRIPTS, needsOpenConfirmation, resolveFileTarget, powerShellArgs, commandPromptArgs } from "./file-actions-core.mjs";

function trusted(event) {
  if (event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === "oc:" && url.host === "renderer" || Boolean(/^https?:$/.test(url.protocol) && process.env.ELECTRON_RENDERER_URL && url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin);
  } catch { return false; }
}

async function launch(executable, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, detached: true, windowsHide: false, stdio: "ignore", ...options });
    child.once("error", () => reject(new Error("无法启动应用，请检查应用是否已安装。")));
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

// Do not search the workspace or an arbitrary PATH for executable programs.
const system = name => path.join(process.env.SystemRoot || "C:\\Windows", "System32", name);
async function powerShell() {
  const pwsh = path.join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe");
  try { if ((await fs.stat(pwsh)).isFile()) return { path: pwsh, name: "PowerShell 7" }; } catch {}
  return { path: system("WindowsPowerShell\\v1.0\\powershell.exe"), name: "Windows PowerShell" };
}

function message(owner, options) {
  return owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
}
async function confirm(owner, title, detail) {
  const result = await message(owner, { type: "warning", title, message: title, detail,
    buttons: ["取消", "继续"], defaultId: 0, cancelId: 0, noLink: true });
  return result.response === 1;
}

export async function inspectTarget(file) {
  try {
    const real = await fs.realpath(file);
    // Symlinks must not silently turn a local path into a network/device target.
    resolveFileTarget({ path: real, directory: path.dirname(real), local: true });
    const stat = await fs.stat(real);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error("不支持此类文件。");
    return { file: real, directory: stat.isDirectory(), extension: path.extname(real).toLowerCase() };
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error("文件不存在，可能已被移动或删除。");
    if (error.code === "EACCES" || error.code === "EPERM") throw new Error("没有访问这个文件的权限。");
    throw error;
  }
}

async function openFile(file, owner) {
  const info = await inspectTarget(file);
  if (process.platform === "win32" && !info.directory && EDIT_SCRIPTS.has(info.extension)) {
    return launch(system("notepad.exe"), [info.file]);
  }
  if (!info.directory && (needsOpenConfirmation(info.file) || process.platform !== "win32" && (await fs.stat(info.file)).mode & 0o111)) {
    if (!await confirm(owner, "使用系统默认应用打开？", `此文件可能被执行，而不只是预览。\n\n${info.file}`)) return;
  }
  const error = await shell.openPath(info.file);
  if (error) throw new Error(`无法打开文件：${error}`);
}

async function terminal(file) {
  const info = await inspectTarget(file);
  const directory = info.directory ? info.file : path.dirname(info.file);
  const ps = await powerShell();
  return launch(ps.path, powerShellArgs(directory), { cwd: directory });
}

async function runScript(file, owner) {
  const info = await inspectTarget(file);
  if (process.platform !== "win32" || info.directory || !EDIT_SCRIPTS.has(info.extension)) throw new Error("不支持运行此类文件。");
  const directory = path.dirname(info.file);
  const ps = info.extension === ".ps1" ? await powerShell() : { path: system("cmd.exe"), name: "命令提示符" };
  if (!await confirm(owner, "运行此脚本？", `脚本：${info.file}\n\n运行方式：${ps.name}\n工作目录：${directory}\n\n请先检查脚本内容；不会请求管理员权限或绕过 PowerShell 执行策略。运行窗口将保持打开以显示结果。`)) return;
  // Revalidate after the dialog. Changing a symlink must not change the approved target.
  const latest = await inspectTarget(info.file);
  if (latest.file !== info.file || latest.directory || latest.extension !== info.extension) throw new Error("文件在确认期间发生变化，请重新操作。");
  if (info.extension === ".ps1") return launch(ps.path, powerShellArgs(directory, info.file), { cwd: directory });
  return launch(ps.path, commandPromptArgs(), { cwd: directory, windowsVerbatimArguments: true,
    env: { ...process.env, OC_MOD_SCRIPT: info.file } });
}

export async function showFileMenu(file, owner, sender) {
  let info, problem;
  try { info = await inspectTarget(file); } catch (error) { problem = error.message; }
  if (sender.isDestroyed()) return;
  const action = fn => () => { void Promise.resolve().then(fn).catch(error => message(owner, {
    type: "error", title: "文件操作失败", message: error.message, buttons: ["关闭"],
  }).catch(() => {})); };
  const items = [
    { label: info?.directory ? "打开文件夹" : process.platform === "win32" && EDIT_SCRIPTS.has(info?.extension) ? "使用文本编辑器打开" : "打开文件", enabled: !!info, click: action(() => openFile(file, owner)) },
    { label: "打开所在文件夹", enabled: !!info, click: action(async () => { const current = await inspectTarget(file); shell.showItemInFolder(current.file); }) },
  ];
  if (info && process.platform === "win32") {
    items.push({ type: "separator" });
    if (!info.directory && EDIT_SCRIPTS.has(info.extension)) items.push({
      label: info.extension === ".ps1" ? "使用 PowerShell 运行…" : "使用命令提示符运行…",
      click: action(() => runScript(file, owner)),
    });
    items.push({ label: info.directory ? "在此处打开终端" : "在所在目录打开终端", click: action(() => terminal(file)) });
  }
  items.push({ type: "separator" }, { label: "复制完整路径", click: () => clipboard.writeText(info?.file || file) });
  if (problem) items.unshift({ label: problem, enabled: false }, { type: "separator" });
  Menu.buildFromTemplate(items).popup({ window: owner });
}

const pending = new Set();
ipcMain.handle("oc-mod:files", async (event, action, data) => {
  if (!trusted(event)) throw new Error("文件操作仅供桌面主窗口使用。");
  if (action !== "open" && action !== "menu") throw new Error("不支持的文件操作。");
  const file = resolveFileTarget(data, process.platform, os.homedir());
  const sender = event.sender;
  if (pending.has(sender.id)) return;
  pending.add(sender.id);
  try {
    const owner = BrowserWindow.fromWebContents(sender);
    if (!owner) throw new Error("找不到文件操作所属窗口。");
    if (action === "open") await openFile(file, owner);
    else await showFileMenu(file, owner, sender);
  } finally { pending.delete(sender.id); }
});
