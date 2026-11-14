#!/usr/bin/env node
/**
 * OpenCode Desktop UI Enhancement Patcher
 * Cross-platform patcher for Windows, macOS, and Linux
 * Compatible with OpenCode Desktop v2.0.x ~ v2.1.x+
 *
 * Features injected:
 * 1. Left Session Timeline Navigation Bar (会话时间轴导航条)
 *    - Displays all user turns (#1, #2, ...) and Assistant Markdown headings (H1~H3)
 *    - Seamlessly integrates with OpenCode virtualized scroller & smooth easing
 *    - Local index cache + lazy hydration
 * 2. Upgraded /btw Side Q&A Companion Panel (右侧多轮问答伴侣面板)
 *    - Top header toggle button & Alt+B shortcut
 *    - Text selection floating pill ("引用到 /btw" / "⚡ 解释", or Alt+Q)
 *    - Independent model selector, context modes, persistent tabs
 * 3. Codex-Style Sidebar with Pinning (Codex 风格侧边栏与项目/会话双置顶)
 *    - Projects accordion grouping with clean session hierarchy (no letter avatars)
 *    - Hover card for projects: pin, chats count, worktree path, direct edit-project trigger
 *    - Pinned section at top for pinned sessions; pinned projects hoisted to top
 *    - Context menu: pin/unpin, rename, delete chat, new chat in project, copy path
 * 4. Voice input beside the main composer send button (语音输入)
 *    - Explicit recording/upload, configurable OpenAI-compatible transcription service
 *    - Narrow audio permissions, encrypted optional key storage, no auto-submit
 * 5. Long text attachments and collapsible user messages (长文本附件与显示更多)
 *    - Native prompt serialization, lossless UTF-8 attachment, 12-line preview
 * 6. Offline persistent goals on 2.2.7+ (持续目标，无独立服务或 npm 安装)
 *    - Prebuilt native server/GUI plugin deployed with the desktop patch
 *
 * Usage:
 *   node apply-mod.mjs            # Apply patch to OpenCode Desktop app.asar
 *   node apply-mod.mjs --restore  # Restore official app.asar from backup
 *   node apply-mod.mjs --force    # Bypass running process check (restart app manually)
 *   node apply-mod.mjs --goals-config <file> # Select between multiple global configs
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { patchVoiceDesktopMain } from "./voice-patch.mjs";
import { patchLongTextComposer } from "./long-text-patch.mjs";
import { patchModelPicker } from "./model-picker-patch.mjs";
import { resolvePanelSymbols, resolvePanelChunkImport } from "./bundle-symbols.mjs";
import { prepareGoals, supportsGoals } from "./goal-plugin/deploy.mjs";
import { patchGoalComposer } from "./goal-composer-patch.mjs";
import { writeDesktopPatch } from "./desktop-install.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const customPanelPath = path.join(__dirname, "panel-c7bWJg2T.js");
const customSidebarPath = path.join(__dirname, "cx-sidebar.js");
const customChatWidthPath = path.join(__dirname, "chat-width.js");

function getCandidateAsarPaths() {
  const custom = process.env.OPENCODE_ASAR_PATH;
  if (custom) return [custom];

  const homedir = os.homedir();
  const platform = process.platform;
  const paths = [];

  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(homedir, "AppData", "Local");
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    paths.push(
      path.join(localAppData, "Programs", "@opencode-aidesktop", "resources", "app.asar"),
      path.join(localAppData, "Programs", "opencode-desktop", "resources", "app.asar"),
      path.join(localAppData, "Programs", "OpenCode", "resources", "app.asar"),
      path.join(localAppData, "Programs", "@opencode", "desktop", "resources", "app.asar"),
      path.join(programFiles, "OpenCode", "resources", "app.asar")
    );
  } else if (platform === "darwin") {
    paths.push(
      "/Applications/OpenCode.app/Contents/Resources/app.asar",
      path.join(homedir, "Applications", "OpenCode.app", "Contents", "Resources", "app.asar")
    );
  } else {
    // Linux / BSD
    paths.push(
      "/usr/lib/opencode/resources/app.asar",
      "/opt/OpenCode/resources/app.asar",
      "/opt/opencode/resources/app.asar",
      path.join(homedir, ".local", "share", "opencode", "resources", "app.asar")
    );
  }
  return paths;
}

function resolveAsarPath() {
  const candidates = getCandidateAsarPaths();
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return candidates[0];
}

function isProcessRunning(processName) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`tasklist /FI "IMAGENAME eq ${processName}" /NH`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return output.toLowerCase().includes(processName.toLowerCase());
    } else {
      const baseName = processName.replace(/\.exe$/i, "");
      const output = execSync(`pgrep -i "${baseName}"`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return Boolean(output.trim());
    }
  } catch {
    return false;
  }
}

function ensureOpenCodeClosed(force = false) {
  const procName = process.platform === "win32" ? "OpenCode.exe" : "OpenCode";
  if (isProcessRunning(procName)) {
    if (force) {
      console.log(`[提示] 检测到 OpenCode 正在运行，但已启用 --force 参数，跳过进程锁阻断。注入后请重启客户端生效。`);
      return;
    }
    console.error(`\n[错误] 检测到 OpenCode 桌面端正在运行 (${procName})！`);
    console.error(`[提示] 为避免 app.asar 文件句柄被系统占用锁定 (EBUSY)，请先完全关闭 OpenCode 后再执行此脚本。`);
    console.error(`[提示] 如果确认当前未被占用，也可追加 --force 参数强制注入 (例如: node apply-mod.mjs --force)。\n`);
    process.exit(1);
  }
}

function computeIntegrity(buffer) {
  const blockSize = 4 * 1024 * 1024; // 4 MB
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const blocks = [];
  for (let offset = 0; offset < buffer.length; offset += blockSize) {
    const slice = buffer.subarray(offset, Math.min(offset + blockSize, buffer.length));
    blocks.push(crypto.createHash("sha256").update(slice).digest("hex"));
  }
  if (blocks.length === 0) {
    blocks.push(crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
  }
  return {
    algorithm: "SHA256",
    hash,
    blockSize,
    blocks,
  };
}

function parseAsar(buf) {
  const u1 = buf.readUInt32LE(4);
  const u3 = buf.readUInt32LE(12);
  const headerEnd = 8 + u1;
  const headerJson = buf.subarray(16, 16 + u3).toString("utf8");
  const header = JSON.parse(headerJson);
  const payload = buf.subarray(headerEnd);
  return { header, payload, headerEnd };
}

function readFileFromAsar(payload, node) {
  const offset = Number(node.offset);
  return payload.subarray(offset, offset + node.size);
}

function getAsarVersion(header, payload) {
  try {
    const pkgNode = header?.files?.["package.json"];
    if (pkgNode) {
      const offset = Number(pkgNode.offset);
      const pkgBuf = payload.subarray(offset, offset + pkgNode.size);
      const pkg = JSON.parse(pkgBuf.toString("utf8"));
      return pkg.version || "unknown";
    }
  } catch {}
  return "unknown";
}

function isAsarPatched(header, payload) {
  try {
    const assetsMap = header?.files?.out?.files?.renderer?.files?.assets?.files || {};
    const mainFileName = Object.keys(assetsMap).find((k) => /^main-[A-Za-z0-9_-]+\.js$/.test(k));
    if (!mainFileName) return false;
    const node = assetsMap[mainFileName];
    const offset = Number(node.offset);
    const mainBuf = payload.subarray(offset, offset + node.size);
    return (
      mainBuf.includes(Buffer.from("window.__oc_app_ext")) ||
      mainBuf.includes(Buffer.from("window.__oc_btw_slash")) ||
      mainBuf.includes(Buffer.from("/btw 随时问答")) ||
      mainBuf.includes(Buffer.from("sidebar-codex.js")) ||
      mainBuf.includes(Buffer.from("chat-width.js")) ||
      mainBuf.includes(Buffer.from("long-text.mjs"))
    );
  } catch {
    return false;
  }
}

function patchMainBundle(src, panelFileName, origPanelSrc, symbols) {
  let out = src;

  // 1. Widen default session-chat-panel width when right side panel is opened (600 -> 1080)
  out = out.replace(
    /([a-zA-Z0-9_$]+=344,[a-zA-Z0-9_$]+=200,)([a-zA-Z0-9_$]+=)600(,[a-zA-Z0-9_$]+=280)/,
    "$1$21080$3"
  );

  // 2. Locate btw extension setup function in main bundle
  const importIdx = out.indexOf(`import(\`./${panelFileName}\`)`);
  if (importIdx === -1) {
    throw new Error(`Could not find import for ${panelFileName} in main bundle.`);
  }

  const fnStartMatch = out
    .slice(Math.max(0, importIdx - 150), importIdx)
    .match(/([a-zA-Z0-9_$]+)=e=>\{let\s+([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(\(\)=>([a-zA-Z0-9_$]+)\(\(\)=>$/);
  if (!fnStartMatch) {
    throw new Error("Could not find function start for btw extension setup in main bundle.");
  }

  const endPattern = /\.delete\([a-zA-Z0-9_$]+\.tab\.id\)\}\}\)\}/;
  const endMatch = out.slice(importIdx).match(endPattern);
  if (!endMatch) {
    throw new Error("Could not find function end for btw extension setup in main bundle.");
  }

  const iStart = importIdx - fnStartMatch[0].length;
  const iEnd = importIdx + endMatch.index + endMatch[0].length;
  const fnBody = out.slice(iStart, iEnd);

  const matchedIseName = fnStartMatch[1];
  const matchedZe = fnStartMatch[3];
  const matchedG = fnStartMatch[4];

  // Vite's second argument is always a dependency array, even when empty.
  // Omitting [] shifts import.meta.url into that slot and crashes on t.map().
  const mapDepsMatch = fnBody.match(/__vite__mapDeps\(\[([0-9,\s]+)\]\)/);
  const mapDepsArg = mapDepsMatch ? `__vite__mapDeps([${mapDepsMatch[1]}]),` : "[],";

  const preloadMatch = fnBody.match(
    /([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\(\(\)=>void [a-zA-Z0-9_$]+\.preload\(\)\)\);/
  );
  if (!preloadMatch) throw new Error("无法解析 /btw 预加载挂钩，未写入补丁。");
  const matchedA = preloadMatch[1];
  const matchedRI = preloadMatch[2];

  const storeMatch = fnBody.match(
    /let [a-zA-Z0-9_$]+=e\.layout,[a-zA-Z0-9_$]+=e\.sessions,([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(e\),([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(\(\)=>!!/
  );
  if (!storeMatch) throw new Error("无法解析 /btw 会话挂钩，未写入补丁。");
  const matchedDoe = storeMatch[2];
  const matchedE = storeMatch[4];

  const cmdMatch = fnBody.match(/e\.add\(([a-zA-Z0-9_$]+),\(\)=>\(?\{id:[`'"]ask[`'"]/);
  if (!cmdMatch) throw new Error("无法解析 /btw 命令挂钩，未写入补丁。");
  const matchedCmdExt = cmdMatch[1];

  const sideMatch = fnBody.match(/e\.add\(([a-zA-Z0-9_$]+),\{id:[`'"]main[`'"],region:[`'"]side[`'"]/);
  if (!sideMatch) throw new Error("无法解析 /btw 面板挂钩，未写入补丁。");
  const matchedSideExt = sideMatch[1];

  const labelMatch = fnBody.match(
    /var [a-zA-Z0-9_$]+=([a-zA-Z0-9_$]+)\(\),[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\.firstChild;return ([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+,([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+),\{name:[`'"]bubble-5[`'"]/
  );
  const matchedOoe = labelMatch?.[1] || fnBody.match(/label:[\w$]+=>\(\(\)=>\{var [\w$]+=([\w$]+)\(\),[\w$]+=[\w$]+\.firstChild/)?.[1];
  if (!matchedOoe) throw new Error("无法解析 /btw 标签模板，未写入补丁。");

  const suspenseMatch = fnBody.match(
    /render:[a-zA-Z0-9_$]+=>[a-zA-Z0-9_$]+\(([a-zA-Z0-9_$]+),\{get children\(\)\{return/
  );
  if (!suspenseMatch) throw new Error("无法解析 /btw 渲染挂钩，未写入补丁。");
  const matchedZeWrapper = suspenseMatch[1];

  const headerExtMatch = out.match(/e\.add\(([a-zA-Z0-9_$]+),\{at:[`'"]session\.header[`'"],order:/);
  if (!headerExtMatch) throw new Error("无法解析会话顶栏挂钩，未写入补丁。");
  const headerExt = headerExtMatch[1];

  const exportIdx = out.lastIndexOf("export{");
  const exportsStr = exportIdx !== -1 ? out.slice(exportIdx) : "";
  function findInternalName(exportName, fallback) {
    if (!exportName) return fallback;
    const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = exportsStr.match(new RegExp(`([a-zA-Z0-9_$]+)\\s+as\\s+${escaped}(?=[,}])`));
    return m ? m[1] : fallback;
  }

  const matchedTooltip = findInternalName(symbols.Tooltip);
  const matchedButton = findInternalName(symbols.Button);
  const matchedShow = findInternalName(symbols.Show);
  const matchedIconComponent = findInternalName(symbols.Icon);
  const matchedCleanup = findInternalName(symbols.onCleanup);
  const matchedH = findInternalName(symbols.insert);
  const matchedF = findInternalName(symbols.createComponent);
  const matchedIcon = matchedIconComponent;
  if (![matchedTooltip, matchedButton, matchedShow, matchedIconComponent, matchedCleanup, matchedH, matchedF].every(Boolean)) {
    throw new Error("无法解析 /btw 主包组件，未写入补丁。");
  }

  const replacementIse = [
    `${matchedIseName}=e=>{`,
    "window.__oc_app_ext=e;",
    `let t=${matchedZe}(()=>${matchedG}(()=>import(\`./${panelFileName}\`),${mapDepsArg}import.meta.url));`,
    `${matchedA}(${matchedRI}(()=>void t.preload()));`,
    `${matchedG}(()=>import(\`./${panelFileName}\`),${mapDepsArg}import.meta.url).then(m=>m.initCompanion?.(e)).catch(err=>console.error('[mod-companion] initialization failed',err));`,
    `import(\`./sidebar-codex.js\`).then(m=>{window.__oc_cx_sidebar=m}).catch(()=>{});`,
    `let n=e.layout,r=e.sessions,i=${matchedDoe}(e),a=${matchedE}(()=>!!r.current()),`,
    `mainTab={id:\`main\`,get title(){return\`/btw\`},draggable:!1,closable:\`compact\`,fallback:!0,label:()=>((()=>{var r=${matchedOoe}(),a=r.firstChild;return ${matchedH}(r,${matchedF}(${matchedIcon},{name:\`bubble-5\`,size:\`small\`}),a),${matchedH}(a,()=>\`/btw\`),r})())};`,
    `e.add(${headerExt},{at:\`session.header\`,order:15,render:p=>{return ${matchedF}(${matchedShow},{get when(){return p.session.id},get children(){return ${matchedF}(${matchedTooltip},{value:\`/btw 随时问答 (Alt+B)\`,placement:\`bottom\`,get children(){return ${matchedF}(${matchedButton},{type:\`button\`,variant:\`ghost-muted\`,class:\`group shrink-0\`,style:{padding:\`0 6px\`,color:\`var(--v2-text-text-faint)\`},onClick:()=>{p.session.id&&n.toggle(\`btw:main\`,p.session)},get\"aria-expanded\"(){return n.state(\`btw:main\`,p.session)===\`visible\`},\"aria-label\":\`/btw 随时问答\`,get children(){var el=${matchedOoe}(),sp=el.firstChild;return ${matchedH}(el,${matchedF}(${matchedIcon},{name:\`bubble-5\`,size:\`small\`}),sp),${matchedH}(sp,()=>\`/btw\`),el}})}})}})}});`,
    `e.add(${matchedCmdExt},()=>({id:\`ask\`,title:\`/btw 随时问答\`,description:\`打开右侧多轮问答面板，支持划词引用、自由切换模型与上下文控制\`,group:e.t(\`command.category.session\`),section:\`session\`,bind:\`alt+b\`,slash:{name:\`btw\`,arguments:!0},enabled:!n.narrow()&&a(),run:arg=>{let cur=r.current();if(!cur?.id)return;if(window.__oc_btw_slash){window.__oc_btw_slash(arg,cur);return}n.toggle(\`btw:main\`,cur)}}));`,
    `e.add(${matchedSideExt},{id:\`main\`,region:\`side\`,normalize:()=>\`main\`,legacy:{btw:\`main\`},list:t=>t.open.length>0?[mainTab]:[],render:p=>${matchedF}(${matchedZeWrapper},{get children(){return ${matchedF}(t,{btw:i,get session(){return p.session},get id(){return\`main\`}})}})})`,
    "}",
  ].join("");

  out = out.slice(0, iStart) + replacementIse + out.slice(iEnd);

  // 3. Isolate ephemeral SSE streaming sessions from main store & notifications
  const skipBtwEvent = (param) => `if(${param}?.data?.sessionID?.startsWith?.("ses_btw_")||window.__oc_active_btw_sessions?.has?.(${param}?.data?.sessionID))return;`;
  // Keep legacy anchors preferred: a different switch/listener may precede them.
  const reducerPattern = out.includes("function de(e){switch(e.type){")
    ? /function (de)\((e)\)\{switch\(e\.type\)\{/
    : /function\s+([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\)\{switch\(\2\.type\)\{/;
  out = out.replace(reducerPattern, (match, _name, param) => match.replace("{", "{" + skipBtwEvent(param)));

  const listenerPattern = out.includes("D=e.sdk.event.listen(e=>{")
    ? /(D=)(e)\.sdk\.event\.listen\((e)=>\{/
    : /([a-zA-Z0-9_$]+=)([a-zA-Z0-9_$]+)\.sdk\.event\.listen\(([a-zA-Z0-9_$]+)=>\{/;
  out = out.replace(listenerPattern, (match, _assignment, _context, param) => match + skipBtwEvent(param));

  // 4. Inject Codex-style sidebar with pinning into desktop vertical tabs
  const propPattern = /\{orientation:[`'"]vertical[`'"],(?:get highlightActive\(\)\{return [\w$]+\?\.\(\)\},)?(?:get sections\(\)\{return [\w$]+\?\.sections\},get tabFooter\(\)\{return [\w$]+\?\.tabFooter\},get tabLabel\(\)\{return [\w$]+\?\.tabLabel\},)?tabs:([a-zA-Z0-9_$]+),get currentTab\(\)\{return ([a-zA-Z0-9_$]+)\(\)\},onNavigate:\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)=>\{[\s\S]+?\.reorder\([a-zA-Z0-9_$]+\)\}/;
  const propMatch = out.match(propPattern);
  let vTabsInjected = false;
  if (propMatch) {
    const prefixSlice = out.slice(Math.max(0, propMatch.index - 500), propMatch.index);
    let startMatch = [...prefixSlice.matchAll(/([a-zA-Z0-9_$]+)\(\),\(\(\)=>\{var\s+([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(\);return\s+([a-zA-Z0-9_$]+)\(\2,/g)].pop();
    // 2.2.6 selects inbox/projects/flat tabs inside a dedicated sidebar host.
    const containers = [...out.matchAll(/\(\(\)=>\{var ([\w$]+)=([\w$]+)\(\);return ([\w$]+)\(\1,([\w$]+\([\w$]+,\{get when\(\)\{return [\w$]+\.appearance\.tabLayout\(\)===`inbox`\},get fallback\(\)\{return [\s\S]{0,600}?\.general\.sidebarOrganize\(\)===`projects`[\s\S]{0,600}?)\)\),\1\}\)\(\)/g)];
    // 2.3.0 uses a Switch-like host with inbox/projects/customize/recent cases.
    containers.push(...out.matchAll(/\(\(\)=>\{var ([\w$]+)=([\w$]+)\(\);return ([\w$]+)\(\1,([\w$]+\([\w$]+,\{get fallback\(\)\{return [\w$]+\(\)\},get children\(\)\{return\[[\s\S]{0,1400}?\.appearance\.tabLayout\(\)===`inbox`[\s\S]{0,1800}?\.general\.sidebarOrganize\(\)===`recent`[\s\S]{0,200}?\]\}\})\)\),\1\}\)\(\)/g));
    if (containers.length > 1) throw new Error("无法唯一定位桌面侧边栏容器，未写入补丁。");
    const container = containers[0];
    if (container) startMatch = ["", "", container[1], container[2], container[3]];
    if (startMatch) {
      const fullStart = container ? container.index : propMatch.index - prefixSlice.length + startMatch.index;
      const afterSlice = out.slice(propMatch.index, propMatch.index + 800);
      const endMatch = container || afterSlice.match(new RegExp(`\\),${startMatch[2]}\\}\\)\\(\\)`));
      if (endMatch) {
        const fullEnd = container ? container.index + container[0].length : propMatch.index + endMatch.index + endMatch[0].length;
        const fullBlock = out.slice(fullStart, fullEnd);

        const prefixFn = startMatch[1];
        const cVar = startMatch[2];
        const hVar = startMatch[3];
        const insFn = startMatch[4];
        const origExpr = container ? container[4] + ")" : fullBlock.slice(startMatch[0].length, fullBlock.length - endMatch[0].length);
        const crComp = origExpr.match(/^([a-zA-Z0-9_$]+)\(/)?.[1];

        const props = propMatch[0];
        const tabsVar = propMatch[1];
        const currentTabFn = propMatch[2];
        const tabsStoreVar = props.match(/onNavigate:\s*\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\s*=>\s*\{(?:[\w$]+\?\.\(\),)?([a-zA-Z0-9_$]+)\.select/)?.[1];
        const tabKeyFn = props.match(/findIndex\([a-zA-Z0-9_$]+=>([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+\)===\1\(/)?.[1];

        const sliceBefore = out.slice(Math.max(0, fullStart - 12000), fullStart);
        const srvListMatch = sliceBefore.match(/([a-zA-Z0-9_$]+)\.servers\.list\(\)/);
        const serversVar = srvListMatch?.[1];
        const srvKeyMatch = sliceBefore.match(/([a-zA-Z0-9_$]+)\.key\([a-zA-Z0-9_$]+\)/);
        const serverKeyObj = srvKeyMatch?.[1];
        if (!crComp || !tabKeyFn || !tabsStoreVar || !serversVar || !serverKeyObj) throw new Error("无法安全解析桌面侧边栏依赖，未写入补丁。");

        const settingsHookMatch = src.match(/var\{use:([a-zA-Z0-9_$]+),provider:([a-zA-Z0-9_$]+)\}=([a-zA-Z0-9_$]+)\(\{name:[`'"]SettingsSurface[`'"]/);
        if (!settingsHookMatch) throw new Error("无法安全解析桌面侧边栏设置接口，未写入补丁。");
        const settingsHook = settingsHookMatch[1];
        const settingsProvider = settingsHookMatch[2];

        const replacement = [
          `${prefixFn ? prefixFn + "()," : ""}(()=>{`,
          `var ${cVar}=${hVar}(),orig=${origExpr},host=document.createElement('div'),origWrap=document.createElement('div');`,
          "host.className='oc-cx-host-container flex min-h-0 flex-1 flex-col';",
          "origWrap.style.display='none';",
          `${insFn}(origWrap,orig);`,
          `var deps={servers:${serversVar},tabsStore:${tabsStoreVar},tabs:${tabsVar},current:()=>${currentTabFn}(),tabKey:${tabKeyFn},serverKey:${serverKeyObj}.key,settings:(()=>{try{return ${settingsHook}()}catch(e){try{return ${settingsProvider}()}catch(e2){return null}}})(),locale:()=>{try{return r.locale?.()||r.language?.()}catch(e){return'zh'}}};`,
          // createComponent runs untracked: snapshot reads must not subscribe the sidebar's parent.
          "var cxDisposed=!1,cxDispose;",
          "__oc_cx_onCleanup(()=>{cxDisposed=!0;cxDispose?.()});",
          `var cxStart=m=>${crComp}(()=>{if(!cxDisposed)cxDispose=m.mount(host,deps)});`,
          "if(window.__oc_cx_sidebar?.mount){cxStart(window.__oc_cx_sidebar)}else{import('./sidebar-codex.js').then(m=>{window.__oc_cx_sidebar=m;cxStart(m)}).catch(err=>{console.error('[cx-sidebar]',err);origWrap.style.display='';host.style.display='none'})};",
          `return ${insFn}(${cVar},[host,origWrap]),${cVar};`,
          "})()",
        ].join("");

        out = out.slice(0, fullStart) + replacement + out.slice(fullEnd);
        vTabsInjected = true;
      }
    }
  }

  if (vTabsInjected) {
    // Capture at module scope: the vertical-tab component shadows A with its UI store.
    out = `const __oc_cx_onCleanup=${matchedCleanup};\n${out}`;
    console.log("[patch] 成功注入 Codex 侧边栏与置顶模块挂钩。");
  } else {
    console.warn("[patch] 警告：未能匹配垂直标签栏挂钩，跳过 Codex 侧边栏注入。");
  }

  // 5. Connect modal dialog activity to embed/webview visibility so the native layer is hidden when a modal is open
  const fleMatch = out.match(
    /([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(\{bridge:([a-zA-Z0-9_$]+)\.(?:extensions|plugins),zoom:([^,]+),dialog:\(\)=>!!([a-zA-Z0-9_$]+)\.active([^}]*)\}\)/
  );
  if (fleMatch) {
    const sigFn = findInternalName(symbols.createSignal);
    const bridgeProp = fleMatch[0].includes(".plugins") ? "plugins" : "extensions";
    const extraProps = fleMatch[6] || "";
    const replacement = `[__oc_mod_dlg,__oc_set_mod_dlg]=${sigFn}(!1),__oc_reg_mod_dlg=(window.__oc_set_dialog_active=__oc_set_mod_dlg),${fleMatch[1]}=${fleMatch[2]}({bridge:${fleMatch[3]}.${bridgeProp},zoom:${fleMatch[4]},dialog:()=>!!${fleMatch[5]}.active||__oc_mod_dlg()${extraProps}})`;
    out = out.slice(0, fleMatch.index) + replacement + out.slice(fleMatch.index + fleMatch[0].length);
    console.log("[patch] 成功挂钩原生视图遮罩联动 (WebContentsView Modal Bridge)。");
  } else {
    console.warn("[patch] 警告：未能匹配原生视图遮罩联动挂钩。");
  }

  return out;
}

function patchSessionRouteBundle(src) {
  let out = src;

  // 1. Allow right side panel to be resized down to 340px instead of 480px minimum
  out = out.replace(/([a-zA-Z0-9_$]+=)480(,[a-zA-Z0-9_$]+=800)/, "$1340$2");

  // 2. Expose timeline controller on window.__oc_timeline_ctrl & window.__oc_current_session
  const mvMatch212 = out.match(
    /([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\),([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(\{sessionID:\3\.identity\.sessionID,scrollRef:\1\.scroller/
  );
  if (mvMatch212) {
    const origCtrlVar = mvMatch212[1];
    const fnMv = mvMatch212[2];
    const sessVar = mvMatch212[3];
    out = out.replace(
      `${origCtrlVar}=${fnMv}(${sessVar})`,
      `${origCtrlVar}=(window.__oc_current_session=${sessVar},window.__oc_timeline_ctrl=${fnMv}(${sessVar}))`
    );
  } else {
    const mvMatch2032 = out.match(
      /([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\),([a-zA-Z0-9_$]+=)([a-zA-Z0-9_$]+)\(\3\)/
    );
    if (mvMatch2032 && !out.slice(Math.max(0, mvMatch2032.index - 50), mvMatch2032.index).includes("Math.")) {
      const origCtrlVar = mvMatch2032[1];
      const fnMv = mvMatch2032[2];
      const sessVar = mvMatch2032[3];
      out = out.replace(
        mvMatch2032[0],
        `${origCtrlVar}=(window.__oc_current_session=${sessVar},window.__oc_timeline_ctrl=${fnMv}(${sessVar})),${mvMatch2032[4]}${mvMatch2032[5]}(${sessVar})`
      );
    } else {
      throw new Error("Could not locate timeline controller in route bundle.");
    }
  }

  // 3. Expose virtualizer instance M and scrollAdjustment flusher on window.__oc_virtual_scroll
  const reveals = [...out.matchAll(
    /([\w$]+)\.setRevealMessage\?\.\(\(([\w$]+),([\w$]+)\)=>\{(?:if\(![\w$]+\(\)\)return;)?let [\w$]+=\3\?([\w$]+)\(\)\.findIndex\([\w$]+=>([\w$]+)\([\w$]+,[`'"]AssistantPart[`'"]\)[^}]+?([\w$]+)\.scrollToIndex/g
  )];
  const revealRegistrations = (out.match(/\.setRevealMessage\?\.\(/g) ?? []).length - (out.match(/\.setRevealMessage\?\.\(\(\)=>\{\}\)/g) ?? []).length;
  if (reveals.length !== 1 || revealRegistrations !== 1) {
    throw new Error(`Could not uniquely locate virtual-scroll reveal callback (${reveals.length} matches).`);
  }
  const revealMatch = reveals[0];
  const [, receiver, messageParam, partParam, itemsFn, checkFn, virtVar] = revealMatch;
  const flusherMatch = revealMatch[0].match(/([\w$]+)\(\),([\w$]+)\.scrollToIndex$/);
  if (!flusherMatch || flusherMatch[2] !== virtVar) throw new Error("Could not locate virtual-scroll flusher; refusing to guess a symbol.");
  const flusherVar = flusherMatch[1];
  // 2.2.5 first tries an actual UserMessage row before the projection fallback.
  const userRow = revealMatch[0].match(/,([\w$]+)=([\w$]+)\(\)\.findIndex\(([\w$]+)=>([\w$]+)\(\3,[`'"]UserMessage[`'"]\)&&\3\.userMessageID===([\w$]+)\)/);
  if ((userRow && (userRow[2] !== itemsFn || userRow[4] !== checkFn || userRow[5] !== messageParam)) || (!userRow && revealMatch[0].includes("UserMessage"))) {
    throw new Error("Could not safely resolve virtual-scroll user-row lookup.");
  }
  // Reuse native callback parameters so they cannot shadow its captured helpers.
  const userLookup = userRow ? `let __oc_user_row=${itemsFn}().findIndex(__oc_row=>${checkFn}(__oc_row,\`UserMessage\`)&&__oc_row.userMessageID===${messageParam});if(__oc_user_row>=0)return __oc_user_row;` : "";
  const bridge = `window.__oc_virtual_scroll={M:${virtVar},be:${flusherVar},unpin:${flusherVar},getRowIndex:(${messageParam},${partParam})=>{let __oc_part_row=${partParam}?${itemsFn}().findIndex(__oc_row=>${checkFn}(__oc_row,\`AssistantPart\`)&&__oc_row.group.type===\`part\`&&__oc_row.group.ref.partID===${partParam}):-1;if(__oc_part_row>=0)return __oc_part_row;${userLookup}return ${receiver}.projection.messageRowIndex().get(${messageParam})}},`;
  const revealStart = `${receiver}.setRevealMessage?.((${messageParam},${partParam})=>{`;
  if (!revealMatch[0].startsWith(revealStart)) throw new Error("Could not locate virtual-scroll insertion point.");
  // Insert at the matched position, never a hardcoded pair of minified params.
  out = out.slice(0, revealMatch.index) + bridge + out.slice(revealMatch.index);

  // Leave native message actions (including fork) and the copy footer untouched.
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force") || args.includes("-f");
  const goalsConfigFlag = args.indexOf("--goals-config");
  if (goalsConfigFlag >= 0 && (!args[goalsConfigFlag + 1] || args[goalsConfigFlag + 1].startsWith("--"))) throw new Error("--goals-config 后需要明确的配置路径。");
  const goalsConfig = goalsConfigFlag >= 0 ? path.resolve(args[goalsConfigFlag + 1]) : undefined;
  const asarPath = resolveAsarPath();
  const bakPath = `${asarPath}.bak`;

  if (!asarPath || (!fs.existsSync(asarPath) && !fs.existsSync(bakPath))) {
    console.error(`[错误] 未找到 OpenCode 的 app.asar 文件！`);
    console.error(`尝试检索的路径列表：`);
    getCandidateAsarPaths().forEach((p) => console.error(`  - ${p}`));
    console.error(`\n如果你的 OpenCode 安装在自定义目录，可通过环境变量指定：`);
    console.error(`  Windows (PowerShell): $env:OPENCODE_ASAR_PATH="你的路径\\app.asar"; node apply-mod.mjs`);
    console.error(`  Windows (CMD):        set OPENCODE_ASAR_PATH=你的路径\\app.asar && node apply-mod.mjs`);
    console.error(`  macOS / Linux:        OPENCODE_ASAR_PATH="/path/to/app.asar" node apply-mod.mjs\n`);
    process.exit(1);
  }

  // Ensure OpenCode process is closed before modifying files (unless --force)
  ensureOpenCodeClosed(force);

  if (args.includes("--restore")) {
    if (!fs.existsSync(bakPath)) {
      console.error(`[restore] 未找到备份文件：${bakPath}`);
      process.exit(1);
    }
    const goals = prepareGoals({ uninstall: true, configFile: goalsConfig });
    writeDesktopPatch(asarPath, fs.readFileSync(bakPath), goals);
    console.log(`[restore] 成功从官方备份恢复：${bakPath} -> ${asarPath}`);
    console.log(`[restore] 已撤销本补丁登记的目标功能；保留目标、会话及代码。`);
    console.log(`[restore] 请启动 OpenCode 桌面端。`);
    return;
  }

  // Check version and state of current asar
  if (!fs.existsSync(asarPath) && fs.existsSync(bakPath)) {
    console.log(`[patch] 检测到目标 app.asar 不存在但官方备份有效，将自动基于备份文件生成 app.asar ...`);
  }
  const curRawAsar = fs.existsSync(asarPath) ? fs.readFileSync(asarPath) : null;
  let curVersion = "unknown";
  let curIsPatched = false;

  if (curRawAsar) {
    try {
      const parsed = parseAsar(curRawAsar);
      curVersion = getAsarVersion(parsed.header, parsed.payload);
      curIsPatched = isAsarPatched(parsed.header, parsed.payload);
    } catch {}
  }

  // Handle backup file logic safely
  if (!fs.existsSync(bakPath)) {
    if (curIsPatched) {
      console.log(`[patch] 警告：当前 app.asar 已包含补丁且无官方备份，将基于当前文件生成备份。`);
    } else {
      console.log(`[patch] 正在创建官方原始文件备份至 ${bakPath} ...`);
    }
    fs.copyFileSync(asarPath, bakPath);
  } else {
    // If bak exists, check if OpenCode was updated to a newer official version
    try {
      const bakRaw = fs.readFileSync(bakPath);
      const bakParsed = parseAsar(bakRaw);
      const bakVersion = getAsarVersion(bakParsed.header, bakParsed.payload);

      if (!curIsPatched && curVersion !== "unknown" && curVersion !== bakVersion) {
        console.log(`[patch] 检测到官方客户端已更新 (v${bakVersion} -> v${curVersion})！`);
        console.log(`[patch] 正在刷新官方基准备份 app.asar.bak 为 v${curVersion} ...`);
        fs.copyFileSync(asarPath, bakPath);
      } else {
        console.log(`[patch] 使用干净的官方备份 (${bakPath}, v${bakVersion}) 作为补丁基准 ...`);
      }
    } catch {
      console.log(`[patch] 使用已有的官方备份 (${bakPath}) 作为补丁基准 ...`);
    }
  }

  // Always read from the clean backup as base to ensure pristine idempotent patching
  const rawAsar = fs.readFileSync(bakPath);
  const { header, payload } = parseAsar(rawAsar);
  const targetVersion = getAsarVersion(header, payload);

  if (isAsarPatched(header, payload)) {
    console.warn(`\n[警告] 检测到备份文件 (${bakPath}) 似乎已包含补丁修改！`);
    console.warn(`[提示] 若后续注入报错，建议先重新安装一次 OpenCode 官方安装包以获取干净的基准版本。\n`);
  }

  console.log(`[patch] 目标 OpenCode 版本: v${targetVersion}`);

  const assetsMap = header?.files?.out?.files?.renderer?.files?.assets?.files;
  if (!assetsMap) {
    throw new Error("Could not find out/renderer/assets in app.asar header.");
  }

  const mainFileName = Object.keys(assetsMap).find((k) => /^main-[A-Za-z0-9_-]+\.js$/.test(k));
  const routeFileName = Object.keys(assetsMap).find(
    (k) => /^route-[A-Za-z0-9_-]+\.js$/.test(k) && assetsMap[k].size > 200000
  );

  if (!mainFileName || !routeFileName) {
    throw new Error(`Missing expected asset files: main=${mainFileName}, route=${routeFileName}`);
  }

  const origMainSrc = readFileFromAsar(payload, assetsMap[mainFileName]).toString("utf8");
  const origRouteSrc = readFileFromAsar(payload, assetsMap[routeFileName]).toString("utf8");

  // Dynamically detect the btw panel chunk name referenced specifically by btw extension in main bundle
  const btwIdx = origMainSrc.indexOf("slash:{name:`btw`");
  const panelRefMatch =
    (btwIdx !== -1
      ? origMainSrc
          .slice(Math.max(0, btwIdx - 1000), btwIdx)
          .match(/import\([`'"]\.\/(panel-[A-Za-z0-9_-]+\.js)[`'"]\)/)
      : null) || origMainSrc.match(/import\([`'"]\.\/(panel-[A-Za-z0-9_-]+\.js)[`'"]\)/);
  const targetPanelFileName = panelRefMatch ? panelRefMatch[1] : "panel-c7bWJg2T.js";

  if (!assetsMap[targetPanelFileName]) {
    throw new Error(`Missing expected btw panel asset: ${targetPanelFileName}`);
  }

  const origPanelSrc = readFileFromAsar(payload, assetsMap[targetPanelFileName]).toString("utf8");

  console.log(`[patch] 定位关键模块文件:`);
  console.log(`  - 主包入口 (Main):   ${mainFileName}`);
  console.log(`  - 会话路由 (Route):  ${routeFileName}`);
  console.log(`  - 问答面板 (Panel):  ${targetPanelFileName}`);

  // Resolve dynamic symbols for custom panel imports across different OpenCode versions
  const symbols = resolvePanelSymbols(origPanelSrc, origRouteSrc, origMainSrc);
  console.log(`[patch] 动态解析 Solid/OpenCode 组件符号:`, {
    Tooltip: symbols.Tooltip,
    Button: symbols.Button,
    Show: symbols.Show,
    Icon: symbols.Icon,
    createSignal: symbols.createSignal,
    createMemo: symbols.createMemo,
    createEffect: symbols.createEffect,
    onCleanup: symbols.onCleanup,
  });

  let customPanelSrc = fs.readFileSync(customPanelPath, "utf8");

  // Rewrite main bundle imports in custom panel using the resolved symbol aliases
  const oldImportsRegex = /import\s*\{[\s\S]*?\}\s*from\s*["']\.\/main-[^"']+["'];?/;
  const newImports = `import {
  ${symbols.Tooltip} as Tooltip,
  ${symbols.useExtension} as useExtension,
  ${symbols.IconButton} as IconButton,
  ${symbols.createMemo} as createMemo,
  ${symbols.Show} as Show,
  ${symbols.Icon} as Icon,
  ${symbols.Button} as Button,
  ${symbols.createSignal} as createSignal,
  ${symbols.showToast} as showToast,
  ${symbols.insert} as insert,
  ${symbols.createComponent} as createComponent,
  ${symbols.For} as For,
  ${symbols.createEffect} as createEffect,
  ${symbols.onCleanup} as onCleanup,
${symbols.Markdown ? `  ${symbols.Markdown} as Markdown,` : ""}
${symbols.TextShimmer ? `  ${symbols.TextShimmer} as TextShimmer,` : ""}
} from "./${mainFileName}";`;

  customPanelSrc = customPanelSrc.replace(oldImportsRegex, newImports);
  if (symbols.Markdown) customPanelSrc = customPanelSrc.replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/markdown-[^"']+["'];?/, "");
  if (symbols.TextShimmer) customPanelSrc = customPanelSrc.replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/text-shimmer-[^"']+["'];?/, "");

  // Follow the native component call/import, never a similarly named syntax
  // grammar asset. Both component chunks and their export aliases can change.
  for (const [label, chunkPattern] of [
    ["Markdown", /import\s*\{[^}]*\}\s*from\s*["']\.\/markdown-[^"']+["']/],
    ["TextShimmer", /import\s*\{[^}]*\}\s*from\s*["']\.\/text-shimmer-[^"']+["']/],
  ]) {
    if (symbols[label]) continue;
    const dependency = resolvePanelChunkImport(origPanelSrc, label);
    if (!assetsMap[dependency.file]) throw new Error(`缺少 ${label} 模块，未写入补丁。`);
    customPanelSrc = customPanelSrc.replace(chunkPattern, `import { ${dependency.external} as ${label} } from "./${dependency.file}"`);
  }

  const patchedMainBuf = Buffer.from(`import "./chat-width.js";\nimport "./voice-input.mjs";\nimport "./long-text.mjs";\nimport "./goal-composer.mjs";\n` + patchMainBundle(origMainSrc, targetPanelFileName, origPanelSrc, symbols), "utf8");
  const patchedRouteBuf = Buffer.from(patchSessionRouteBundle(origRouteSrc), "utf8");
  const patchedPanelBuf = Buffer.from(customPanelSrc, "utf8");

  const customSidebarSrc = fs.readFileSync(customSidebarPath, "utf8");
  const patchedSidebarBuf = Buffer.from(customSidebarSrc, "utf8");
  const sidebarFileName = "sidebar-codex.js";

  const customChatWidthSrc = fs.readFileSync(customChatWidthPath, "utf8");
  const patchedChatWidthBuf = Buffer.from(customChatWidthSrc, "utf8");
  const chatWidthFileName = "chat-width.js";

  // Locate the native composer by its prompt contract, not a versioned chunk name.
  const composerFiles = Object.keys(assetsMap).filter(name => {
    if (!name.endsWith(".js")) return false;
    const source = readFileFromAsar(payload, assetsMap[name]).toString("utf8");
    return source.includes(".data.session.prompt(") && source.includes("sessionDirectory:") && source.includes("images:");
  });
  if (composerFiles.length !== 1) throw new Error(`无法唯一定位原生输入模块（匹配 ${composerFiles.length} 处），未写入补丁。`);
  const composerFileName = composerFiles[0];
  let composerSource = patchLongTextComposer(readFileFromAsar(payload, assetsMap[composerFileName]).toString("utf8"));
  if (supportsGoals(targetVersion)) composerSource = patchGoalComposer(composerSource, symbols);
  const longTextFiles = [
    [assetsMap, "long-text.mjs", fs.readFileSync(path.join(__dirname, "long-text.mjs"))],
    [assetsMap, "goal-composer.mjs", fs.readFileSync(path.join(__dirname, "goal-composer.mjs"))],
    [assetsMap, composerFileName, Buffer.from(composerSource)],
  ];
  const modelPickerFiles = Object.keys(assetsMap).filter(name => name.endsWith('.js') &&
    !name.startsWith('main-') && readFileFromAsar(payload, assetsMap[name]).toString('utf8').includes('dialog.model.recent'));
  if (modelPickerFiles.length !== 1) throw new Error('无法唯一定位原生模型选择器，未写入补丁。');
  const modelPickerFile = modelPickerFiles[0];
  if (modelPickerFile === composerFileName) {
    longTextFiles[2][2] = Buffer.from(patchModelPicker(composerSource));
  } else {
    longTextFiles.push([assetsMap, modelPickerFile, Buffer.from(patchModelPicker(readFileFromAsar(payload, assetsMap[modelPickerFile]).toString('utf8')))]);
  }
  console.log(`[patch] 模型快捷分组保留完整提供商列表: ${modelPickerFile}`);
  console.log(`[patch] 长文本附件与折叠模块: ${composerFileName}`);

  const desktopFiles = header?.files?.out?.files?.main?.files;
  const preloadFiles = header?.files?.out?.files?.preload?.files;
  if (!desktopFiles?.["index.js"] || !preloadFiles?.["index.cjs"]) throw new Error("缺少桌面主进程或 preload，无法接入语音输入。");
  const voiceFiles = [
    [desktopFiles, "index.js", Buffer.from(patchVoiceDesktopMain(readFileFromAsar(payload, desktopFiles["index.js"]).toString("utf8")))],
    [preloadFiles, "index.cjs", Buffer.concat([readFileFromAsar(payload, preloadFiles["index.cjs"]), Buffer.from("\n" + fs.readFileSync(path.join(__dirname, "voice-preload.cjs"), "utf8"))])],
    ...["voice-main.mjs", "voice-shared.mjs", "voice-service.mjs"].map(name => [desktopFiles, name, fs.readFileSync(path.join(__dirname, name))]),
    ...["voice-input.mjs", "voice-recorder.mjs", "voice-shared.mjs", "voice-audio.mjs"].map(name => [assetsMap, name, fs.readFileSync(path.join(__dirname, name))]),
  ];

  // Append patched files to the end of payload so all existing offsets remain untouched
  const patchedFiles = [
    [assetsMap, mainFileName, patchedMainBuf],
    [assetsMap, routeFileName, patchedRouteBuf],
    [assetsMap, targetPanelFileName, patchedPanelBuf],
    [assetsMap, sidebarFileName, patchedSidebarBuf],
    [assetsMap, chatWidthFileName, patchedChatWidthBuf],
    ...voiceFiles,
    ...longTextFiles,
  ];
  let currentOffset = payload.length;
  for (const [map, name, buffer] of patchedFiles) {
    map[name] = { size: buffer.length, offset: String(currentOffset), integrity: computeIntegrity(buffer) };
    currentOffset += buffer.length;
  }

  const newHeaderJsonBuf = Buffer.from(JSON.stringify(header), "utf8");
  const u3 = newHeaderJsonBuf.length;
  const alignedJsonLen = Math.ceil(u3 / 4) * 4;
  const u2 = 4 + alignedJsonLen;
  const u1 = 4 + u2;
  const u0 = 4;

  const pickleHeader = Buffer.alloc(16 + alignedJsonLen);
  pickleHeader.writeUInt32LE(u0, 0);
  pickleHeader.writeUInt32LE(u1, 4);
  pickleHeader.writeUInt32LE(u2, 8);
  pickleHeader.writeUInt32LE(u3, 12);
  newHeaderJsonBuf.copy(pickleHeader, 16);

  const finalAsarBuf = Buffer.concat([
    pickleHeader,
    payload,
    ...patchedFiles.map(([, , buffer]) => buffer),
  ]);

  const goals = prepareGoals({ version: targetVersion, configFile: goalsConfig });
  writeDesktopPatch(asarPath, finalAsarBuf, goals, curRawAsar);
  if (goals.supported) {
    console.log(`[patch] 持续目标 /goal 已随补丁部署：${goals.pluginDirectory}`);
    console.log(`[patch] 目标功能使用 OpenCode 自带服务，无需独立启动、安装 npm 依赖或保留源码路径。`);
    if (goals.backup) console.log(`[patch] 目标配置备份：${goals.backup}`);
  } else console.log(`[patch] v${targetVersion} 不支持目标接口，保留原有增强；/goal 需要 2.2.7+。`);
  console.log(`\n[patch] 成功完成补丁写入！`);
  console.log(`[patch] 目标文件：${asarPath} (${finalAsarBuf.length} 字节)`);
  console.log(`[patch] 官方原版备份保留在：${bakPath}`);
  console.log(`[patch] 现在可启动 OpenCode 桌面端尽情体验增强功能。\n`);
}

main();
