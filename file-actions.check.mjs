import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { resolveFileTarget, powerShellArgs, commandPromptArgs, EDIT_SCRIPTS, needsOpenConfirmation } from "./file-actions-core.mjs";
import { patchFileActionsRenderer } from "./file-actions-patch.mjs";
import { bindFileRoot, fileLinkTarget, fileSessionContext } from "./file-actions.mjs";

const base = { directory: "D:\\项目\\工作区", local: true };
const resolve = file => resolveFileTarget({ ...base, path: file }, "win32", "C:\\Users\\test");
assert.equal(resolve("生成 文件.pdf"), "D:\\项目\\工作区\\生成 文件.pdf");
assert.equal(resolve("../报告.pdf"), "D:\\项目\\报告.pdf");
assert.equal(resolve("C:\\输出\\部署.PS1"), "C:\\输出\\部署.PS1");
assert.equal(resolve("src/a.ts#L12-L20"), "D:\\项目\\工作区\\src\\a.ts");
assert.equal(resolve("src/a.ts:12:3"), "D:\\项目\\工作区\\src\\a.ts");
assert.equal(resolve("file:///C:/%E6%8A%A5%E5%91%8A/a%20b.pdf#L1"), "C:\\报告\\a b.pdf");
assert.equal(resolve("100%25.pdf"), "D:\\项目\\工作区\\100%25.pdf", "Do not double decode a native marker");
assert.equal(resolve("~/Desktop/a.txt"), "C:\\Users\\test\\Desktop\\a.txt");
assert.equal(resolveFileTarget({ directory: "/home/a", path: "../报告.pdf", local: true }, "linux"), "/home/报告.pdf");
for (const value of ["https://example.com/a", "javascript:alert(1)", "skill://a", "\\\\server\\share\\a", "//server/share/a", "\\\\?\\C:\\a", "C:relative", "C:123", "/root/a", "x.txt:stream", "NUL.txt", "x\u0000.txt", "a\n.txt", "a.ps1.", "a.exe ", "file://server/share/a", "file:///C:/a?x=1", "file:///C:/a%00b", "file:///C:/%5c%5cserver/share/a"]) {
  assert.throws(() => resolve(value), undefined, value);
}
for (const data of [{ ...base, local: false }, { ...base, workspaceID: "remote" }, { directory: "relative", local: true }]) assert.throws(() => resolveFileTarget({ ...data, path: "a" }, "win32"));
assert.ok(needsOpenConfirmation("a.EXE"));
assert.ok(needsOpenConfirmation("a.lnk"));
assert.ok(!needsOpenConfirmation("a.pdf"));
const args = powerShellArgs("D:\\a '& $(test);", "D:\\a '& $(test);\\部署.ps1");
const decoded = Buffer.from(args.at(-1), "base64").toString("utf16le");
assert.equal(decoded, "Set-Location -LiteralPath 'D:\\a ''& $(test);'; & 'D:\\a ''& $(test);\\部署.ps1'");
assert.ok(args.includes("-NoExit"));
assert.doesNotMatch(args.join(" "), /Bypass|ExecutionPolicy/);
assert.deepEqual(commandPromptArgs(), ["/d", "/v:off", "/s", "/k", '""%OC_MOD_SCRIPT%""']);

const fixture = 'openLocalFile:h=>void host.links.open({href:h,session:props.session});root.toggleAttribute(`data-local-links`,!!md?.openLocalFile)';
const patched = patchFileActionsRenderer(fixture);
assert.match(patched, /__ocFileContext:\(\)=>props.session/);
assert.match(patched, /__ocBindFileRoot\?\.\(root,/);
for (const invalid of ["", fixture + fixture, fixture.replace("props.session", "props.other"), fixture.replace("data-local-links", "unknown")]) assert.throws(() => patchFileActionsRenderer(invalid));
const session = { directory: base.directory, server: { local: true } };
assert.deepEqual(fileSessionContext(session), base);
assert.equal(fileSessionContext({ ...session, server: { local: false, url: "http://localhost:1" } }), undefined);
assert.equal(fileSessionContext({ ...session, location: { workspaceID: "remote" } }), undefined);

// Real delegated renderer listeners, including nested link labels and keyboard.
const listeners = new Map(), calls = [];
const root = {
  contains: el => el === link,
  addEventListener: (type, fn, capture) => { assert.equal(capture, true); listeners.set(type, fn); },
  removeEventListener: type => listeners.delete(type),
};
const link = { tagName: "A", dataset: { localLink: "报告.pdf" }, closest: () => root };
const label = { closest: () => link };
const nestedCode = { closest: selector => selector === 'a[data-local-link]' ? link : { tagName: "CODE" } };
assert.equal(fileLinkTarget(nestedCode, root).path, "报告.pdf", "An inline code label must use its containing link's target");
let current = session;
const stop = bindFileRoot(root, () => current, { open: data => calls.push(["open", data]), menu: data => calls.push(["menu", data]) }, error => { throw error; });
const event = extra => ({ target: label, button: 0, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra });
let e = event(); listeners.get("click")(e); await Promise.resolve(); await Promise.resolve();
assert.equal(calls[0][0], "open"); assert.ok(e.prevented && e.stopped);
e = event(); listeners.get("contextmenu")(e); await Promise.resolve(); await Promise.resolve(); assert.equal(calls[1][0], "menu");
listeners.get("keydown")(event({ key: "Enter" })); await Promise.resolve(); await Promise.resolve(); assert.equal(calls.length, 3);
listeners.get("keydown")(event({ key: "F10", shiftKey: true })); await Promise.resolve(); await Promise.resolve(); assert.equal(calls[3][0], "menu");
for (const extra of [{ ctrlKey: true }, { metaKey: true }, { defaultPrevented: true }, { button: 1 }]) {
  e = event(extra); listeners.get("click")(e); assert.ok(!e.prevented);
}
current = { ...session, server: { local: false } }; e = event(); listeners.get("click")(e); assert.ok(!e.prevented);
assert.equal(calls.length, 4);
stop(); assert.equal(listeners.size, 0);

// Run the actual main-process implementation with isolated host APIs. No real
// file is opened, script executed, clipboard changed or user configuration read.
let handler, items, confirmation = 0, missing = false, directory = false, realOverride, hasPwsh = true, openError = "", confirmHook;
const launches = [], opens = [], dialogs = [], copied = [], reveals = [];
const winPath = path.win32;
const frame = { url: "oc://renderer/index.html" };
const sender = { id: 7, mainFrame: frame, isDestroyed: () => false };
const owner = {};
const sandbox = {
  URL, Buffer, Set, Promise, console,
  process: { platform: "win32", env: { SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Program Files" } },
  path: winPath, os: { homedir: () => "C:\\Users\\test" },
  resolveFileTarget: (data, platform = "win32", home) => resolveFileTarget(data, platform, home),
  EDIT_SCRIPTS, needsOpenConfirmation, powerShellArgs, commandPromptArgs,
  fs: { realpath: async file => { if (missing) throw Object.assign(new Error(), { code: "ENOENT" }); return realOverride || file; },
    stat: async file => { if (!hasPwsh && /pwsh\.exe$/.test(file)) throw new Error("missing"); return { isFile: () => /pwsh\.exe$/.test(file) || !directory, isDirectory: () => directory, mode: 0o644 }; } },
  BrowserWindow: { fromWebContents: () => owner },
  clipboard: { writeText: file => copied.push(file) },
  dialog: { showMessageBox: async (_, options) => { dialogs.push(options); confirmHook?.(); return { response: confirmation }; } },
  ipcMain: { handle: (_, fn) => handler = fn },
  Menu: { buildFromTemplate: template => { items = template; return { popup: () => {} }; } },
  shell: { openPath: async file => { opens.push(file); return openError; }, showItemInFolder: file => reveals.push(file) },
  spawn: (exe, args, options) => { launches.push({ exe, args, options }); const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit("spawn")); return child; },
};
const source = fs.readFileSync(new URL("./file-actions-main.mjs", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replaceAll("export async function", "async function");
vm.runInNewContext(source, sandbox);
const evt = { sender, senderFrame: frame };
const tick = () => new Promise(resolve => setImmediate(resolve));
const menu = async file => { await handler(evt, "menu", { ...base, path: file }); return items; };
const select = async label => { const item = items.find(item => item.label === label); assert.ok(item, label); item.click(); await tick(); };
await handler(evt, "open", { ...base, path: "报告.pdf" }); assert.equal(opens.at(-1), resolve("报告.pdf"));
await handler(evt, "open", { ...base, path: "部署.PS1" }); assert.match(launches.at(-1).exe, /System32\\notepad.exe$/); assert.equal(launches.at(-1).options.shell, false);
await menu("部署.ps1"); assert.ok(items.some(item => item.label === "使用 PowerShell 运行…"));
let before = launches.length; await select("使用 PowerShell 运行…"); assert.equal(launches.length, before, "Cancel never launches");
confirmation = 1; await select("使用 PowerShell 运行…"); assert.equal(launches.length, before + 1); assert.match(launches.at(-1).exe, /PowerShell\\7\\pwsh.exe$/);
assert.match(dialogs.at(-1).detail, /工作目录/); assert.ok(launches.at(-1).args.includes("-NoExit"));
hasPwsh = false; await select("使用 PowerShell 运行…"); assert.match(launches.at(-1).exe, /WindowsPowerShell\\v1.0\\powershell.exe$/); assert.match(dialogs.at(-1).detail, /Windows PowerShell/); hasPwsh = true;
before = launches.length; confirmHook = () => { realOverride = "D:\\other.ps1"; }; await select("使用 PowerShell 运行…");
assert.equal(launches.length, before, "A symlink retargeted during confirmation must not execute"); realOverride = undefined; confirmHook = undefined;
await menu("a & (b) %PATH% !x! 部署.cmd"); await select("使用命令提示符运行…");
assert.equal(launches.at(-1).options.env.OC_MOD_SCRIPT, resolve("a & (b) %PATH% !x! 部署.cmd"));
assert.equal(launches.at(-1).options.windowsVerbatimArguments, true);
await select("在所在目录打开终端"); assert.equal(launches.at(-1).options.cwd, base.directory);
await select("打开所在文件夹"); assert.equal(reveals.length, 1);
await select("复制完整路径"); assert.equal(copied.length, 1);
directory = true; await menu("folder"); assert.ok(items.some(item => item.label === "在此处打开终端")); assert.ok(!items.some(item => item.label?.includes("运行…"))); directory = false;
missing = true; await menu("missing.pdf"); assert.equal(items.find(item => item.label === "打开文件").enabled, false); await select("复制完整路径"); assert.equal(copied.at(-1), resolve("missing.pdf")); missing = false;
realOverride = "\\\\server\\share\\a.ps1"; await menu("link.ps1"); assert.equal(items.find(item => item.label === "使用 PowerShell 运行…"), undefined); realOverride = undefined;
confirmation = 0; before = opens.length; await handler(evt, "open", { ...base, path: "a.exe" }); assert.equal(opens.length, before);
for (const bad of [{ ...evt, senderFrame: { url: frame.url } }, { sender: { ...sender, mainFrame: { url: "https://evil.example" } }, senderFrame: { url: "https://evil.example" } }]) await assert.rejects(handler(bad, "open", { ...base, path: "a.pdf" }));
await assert.rejects(handler(evt, "run", { ...base, path: "a.ps1" }));
await assert.rejects(handler(evt, "open", { ...base, local: false, path: "a.pdf" }));
openError = "no application"; await assert.rejects(handler(evt, "open", { ...base, path: "a.pdf" }), /无法打开文件/); openError = "";

const exposed = {};
vm.runInNewContext(fs.readFileSync(new URL("./file-actions-preload.cjs", import.meta.url), "utf8"), {
  require: name => { assert.equal(name, "electron"); return { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer: { invoke: (...args) => args } }; },
});
assert.deepEqual(Object.keys(exposed.__ocFiles).sort(), ["menu", "open"]);
assert.equal(exposed.__ocFiles.open(base)[0], "oc-mod:files");
assert.equal(exposed.__ocFiles.menu(base)[1], "menu");

if (process.platform === "win32") {
  const temp = fs.mkdtempSync(path.join(os.homedir(), "AppData/Local/Temp/opencode/file-actions-"));
  try {
    // Execute only our own inert test fixture. The production /k keeps a window
    // open; /c exercises identical command parsing without leaving a test console.
    const file = path.join(temp, "test & (safe) %PATH% !safe! quote' 测试.cmd");
    fs.writeFileSync(file, '@echo off\r\n@echo "%~f0"\r\n', "utf8");
    const args = commandPromptArgs().map(arg => arg === "/k" ? "/c" : arg);
    const output = execFileSync(path.join(process.env.SystemRoot, "System32/cmd.exe"), args, {
      cwd: temp, windowsVerbatimArguments: true, windowsHide: true, encoding: "buffer", timeout: 10000,
      env: { ...process.env, OC_MOD_SCRIPT: file },
    });
    // CMD's legacy encoding varies; the ASCII basename prefix and suffix prove
    // that ampersands, percent variables, parentheses and quotes stayed literal.
    assert.ok(output.includes(Buffer.from("test & (safe) %PATH% !safe! quote'")));
    assert.ok(output.includes(Buffer.from('.cmd"')));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

console.log("File actions checks passed: paths, quoting, session ownership, renderer events, native menus, cancellation, IPC trust and launch allowlist.");
