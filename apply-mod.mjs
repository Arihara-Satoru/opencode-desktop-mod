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
 * 3. Branch to New Chat (分支到新聊天) button
 *    - Placed next to copy button at assistant turn footer
 *    - Forks conversation up to current assistant turn into a fresh session
 *    - Auto-numbers branch session titles: 原标题 (分支), 原标题 (分支 2)...
 * 4. Codex-Style Sidebar with Pinning (Codex 风格侧边栏与项目/会话双置顶)
 *    - Projects accordion grouping with clean session hierarchy (no letter avatars)
 *    - Hover card for projects: pin, chats count, worktree path, direct edit-project trigger
 *    - Pinned section at top for pinned sessions; pinned projects hoisted to top
 *    - Context menu: pin/unpin, rename, delete chat, new chat in project, copy path
 * 5. Voice input beside the main composer send button (语音输入)
 *    - Explicit recording/upload, configurable OpenAI-compatible transcription service
 *    - Narrow audio permissions, encrypted optional key storage, no auto-submit
 *
 * Usage:
 *   node apply-mod.mjs            # Apply patch to OpenCode Desktop app.asar
 *   node apply-mod.mjs --restore  # Restore official app.asar from backup
 *   node apply-mod.mjs --force    # Bypass running process check (restart app manually)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { patchVoiceDesktopMain } from "./voice-patch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const customPanelPath = path.join(__dirname, "panel-c7bWJg2T.js");
const customSidebarPath = path.join(__dirname, "cx-sidebar.js");

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
      mainBuf.includes(Buffer.from("sidebar-codex.js"))
    );
  } catch {
    return false;
  }
}

function resolvePanelSymbols(origPanelSrc, origRouteSrc, origMainSrc) {
  const panelImportMatch = origPanelSrc.match(/import\{([^}]+)\}from["']\.\/main-[^"']+["']/);
  const panelImports = {};
  if (panelImportMatch) {
    for (const part of panelImportMatch[1].split(",")) {
      const [orig, local] = part.trim().split(/\s+as\s+/);
      panelImports[local || orig] = orig;
    }
  }

  const routeImportMatch = origRouteSrc.match(/import\{([^}]+)\}from["']\.\/main-[^"']+["']/);
  const routeImports = {};
  if (routeImportMatch) {
    for (const part of routeImportMatch[1].split(",")) {
      const [orig, local] = part.trim().split(/\s+as\s+/);
      routeImports[local || orig] = orig;
    }
  }

  let forExport = "il";
  const forMatch = origRouteSrc.match(/([a-zA-Z0-9_$]+)\s*,\s*\{get each\(\)/);
  if (forMatch && routeImports[forMatch[1]]) {
    forExport = routeImports[forMatch[1]];
  }

  let effectExport = "_l";
  const effectMatch = origMainSrc.match(
    /function\s+([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{[a-zA-Z0-9_$]+\([a-zA-Z0-9_$]+\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+,!1,[a-zA-Z0-9_$]+\)\)\}/
  );
  const exportIdx = origMainSrc.lastIndexOf("export{");
  const exportsStr = exportIdx !== -1 ? origMainSrc.slice(exportIdx) : "";
  if (effectMatch) {
    const m = exportsStr.match(new RegExp(`\\b${effectMatch[1]}\\s+as\\s+([a-zA-Z0-9_$]+)`));
    if (m) effectExport = m[1];
  }

  let cleanupExport = "Dl";
  const cleanupMatch = origMainSrc.match(
    /function\s+([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+\)\{return [a-zA-Z0-9_$]+===null\|\|\([a-zA-Z0-9_$]+\.cleanups===null\?[a-zA-Z0-9_$]+\.cleanups=\[[a-zA-Z0-9_$]+\]:[a-zA-Z0-9_$]+\.cleanups\.push\([a-zA-Z0-9_$]+\)\),[a-zA-Z0-9_$]+\}/
  );
  if (cleanupMatch) {
    const m = exportsStr.match(new RegExp(`\\b${cleanupMatch[1]}\\s+as\\s+([a-zA-Z0-9_$]+)`));
    if (m) cleanupExport = m[1];
  }

  let useExtensionExport = panelImports["p"] || "qr";
  const useExtInternalMatch = origMainSrc.match(
    /function\s+([a-zA-Z0-9_$]+)\(\)\{let\s+[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\([a-zA-Z0-9_$]+\);if\(![a-zA-Z0-9_$]+\)throw Error\([`'"]useExtension must run inside an extension contribution[`'"]\)/
  );
  if (useExtInternalMatch) {
    const m = exportsStr.match(new RegExp(`\\b${useExtInternalMatch[1]}\\s+as\\s+([a-zA-Z0-9_$]+)`));
    if (m) useExtensionExport = m[1];
  }

  return {
    onChange: panelImports["t"] || "El",
    Tooltip: panelImports["i"] || "Pn",
    useExtension: useExtensionExport,
    IconButton: panelImports["r"] || "Ln",
    createMemo: panelImports["c"] || "gl",
    ScrollView: panelImports["g"] || "wn",
    Show: panelImports["m"] || "sl",
    Icon: panelImports["l"] || "hi",
    Match: panelImports["d"] || "ol",
    memoBool: panelImports["a"] || "Yc",
    Button: panelImports["e"] || "An",
    createSignal: panelImports["o"] || "bl",
    showToast: panelImports["f"] || "pi",
    insert: panelImports["n"] || "Jc",
    template: panelImports["h"] || "tl",
    Switch: panelImports["u"] || "ll",
    createComponent: panelImports["s"] || "fl",
    For: forExport,
    createEffect: effectExport,
    onCleanup: cleanupExport,
  };
}

function patchMainBundle(src, panelFileName, origPanelSrc) {
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

  // Extract vite dependency mapping array if present in original import
  const mapDepsMatch = fnBody.match(/__vite__mapDeps\(\[([0-9,\s]+)\]\)/);
  const mapDepsArg = mapDepsMatch ? `__vite__mapDeps([${mapDepsMatch[1]}]),` : "";

  const preloadMatch = fnBody.match(
    /([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\(\(\)=>void [a-zA-Z0-9_$]+\.preload\(\)\)\);/
  );
  const matchedA = preloadMatch ? preloadMatch[1] : "A";
  const matchedRI = preloadMatch ? preloadMatch[2] : "NI";

  const storeMatch = fnBody.match(
    /let [a-zA-Z0-9_$]+=e\.layout,[a-zA-Z0-9_$]+=e\.sessions,([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(e\),([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(\(\)=>!!/
  );
  const matchedDoe = storeMatch ? storeMatch[2] : "Doe";
  const matchedE = storeMatch ? storeMatch[4] : "E";

  const cmdMatch = fnBody.match(/e\.add\(([a-zA-Z0-9_$]+),\(\)=>\(?\{id:[`'"]ask[`'"]/);
  const matchedCmdExt = cmdMatch ? cmdMatch[1] : "xI";

  const sideMatch = fnBody.match(/e\.add\(([a-zA-Z0-9_$]+),\{id:[`'"]main[`'"],region:[`'"]side[`'"]/);
  const matchedSideExt = sideMatch ? sideMatch[1] : "CI";

  const labelMatch = fnBody.match(
    /var [a-zA-Z0-9_$]+=([a-zA-Z0-9_$]+)\(\),[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\.firstChild;return ([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+,([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+),\{name:[`'"]bubble-5[`'"]/
  );
  const matchedOoe = labelMatch ? labelMatch[1] : "Ooe";
  const matchedH = labelMatch ? labelMatch[2] : "H";
  const matchedF = labelMatch ? labelMatch[3] : "F";
  const matchedIcon = labelMatch ? labelMatch[4] : "hP";

  const suspenseMatch = fnBody.match(
    /render:[a-zA-Z0-9_$]+=>[a-zA-Z0-9_$]+\(([a-zA-Z0-9_$]+),\{get children\(\)\{return/
  );
  const matchedZeWrapper = suspenseMatch ? suspenseMatch[1] : "Ze";

  const headerExtMatch = out.match(/e\.add\(([a-zA-Z0-9_$]+),\{at:[`'"]session\.header[`'"],order:/);
  const headerExt = headerExtMatch ? headerExtMatch[1] : "OI";

  let matchedTrack = "r7";
  const s7Match = out.match(
    /\{at:[`'"]session\.header[`'"],order:10,render:[a-zA-Z0-9_$]+=>[a-zA-Z0-9_$]+\(([a-zA-Z0-9_$]+),/
  );
  if (s7Match) {
    const s7Name = s7Match[1];
    const trackMatch = out.match(
      new RegExp(`function\\s+${s7Name}\\([a-zA-Z0-9_$]+\\)\\{[\\s\\S]*?([a-zA-Z0-9_$]+)\\(\\(\\)=>[a-zA-Z0-9_$]+\\.session\\)`)
    );
    if (trackMatch) matchedTrack = trackMatch[1];
  }

  // Parse original panel to get export names for Tooltip, Button, Show
  const panelImportMatch = origPanelSrc.match(/import\{([^}]+)\}from["']\.\/main-[^"']+["']/);
  const panelImports = {};
  if (panelImportMatch) {
    for (const part of panelImportMatch[1].split(",")) {
      const [orig, local] = part.trim().split(/\s+as\s+/);
      panelImports[local || orig] = orig;
    }
  }

  const exportIdx = out.lastIndexOf("export{");
  const exportsStr = exportIdx !== -1 ? out.slice(exportIdx) : "";
  function findInternalName(exportName, fallback) {
    if (!exportName) return fallback;
    const m = exportsStr.match(new RegExp(`([a-zA-Z0-9_$]+)\\s+as\\s+${exportName}\\b`));
    return m ? m[1] : fallback;
  }

  const matchedTooltip = findInternalName(panelImports["i"], "AH");
  const matchedButton = findInternalName(panelImports["e"], "zH");
  const matchedShow = findInternalName(panelImports["m"], "R");

  const replacementIse = [
    `${matchedIseName}=e=>{`,
    "window.__oc_app_ext=e;",
    `let t=${matchedZe}(()=>${matchedG}(()=>import(\`./${panelFileName}\`),${mapDepsArg}import.meta.url));`,
    `${matchedA}(${matchedRI}(()=>void t.preload()));`,
    `${matchedG}(()=>import(\`./${panelFileName}\`),${mapDepsArg}import.meta.url).then(m=>m.initCompanion?.(e));`,
    `import(\`./sidebar-codex.js\`).then(m=>{window.__oc_cx_sidebar=m}).catch(()=>{});`,
    `let n=e.layout,r=e.sessions,i=${matchedDoe}(e),a=${matchedE}(()=>!!r.current()),`,
    `mainTab={id:\`main\`,get title(){return\`/btw\`},draggable:!1,closable:\`compact\`,fallback:!0,label:()=>((()=>{var r=${matchedOoe}(),a=r.firstChild;return ${matchedH}(r,${matchedF}(${matchedIcon},{name:\`bubble-5\`,size:\`small\`}),a),${matchedH}(a,()=>\`/btw\`),r})())};`,
    `e.add(${headerExt},{at:\`session.header\`,order:15,render:p=>{${matchedTrack}(()=>p.session);return ${matchedF}(${matchedShow},{get when(){return p.session.id},get children(){return ${matchedF}(${matchedTooltip},{value:\`/btw 随时问答 (Alt+B)\`,placement:\`bottom\`,get children(){return ${matchedF}(${matchedButton},{type:\`button\`,variant:\`ghost-muted\`,class:\`group shrink-0\`,style:{padding:\`0 6px\`,color:\`var(--v2-text-text-faint)\`},onClick:()=>{p.session.id&&n.toggle(\`btw:main\`,p.session)},get\"aria-expanded\"(){return n.state(\`btw:main\`,p.session)===\`visible\`},\"aria-label\":\`/btw 随时问答\`,get children(){var el=${matchedOoe}(),sp=el.firstChild;return ${matchedH}(el,${matchedF}(${matchedIcon},{name:\`bubble-5\`,size:\`small\`}),sp),${matchedH}(sp,()=>\`/btw\`),el}})}})}})}});`,
    `e.add(${matchedCmdExt},()=>({id:\`ask\`,title:\`/btw 随时问答\`,description:\`打开右侧多轮问答面板，支持划词引用、自由切换模型与上下文控制\`,group:e.t(\`command.category.session\`),section:\`session\`,bind:\`alt+b\`,slash:{name:\`btw\`,arguments:!0},enabled:!n.narrow()&&a(),run:arg=>{let cur=r.current();if(!cur?.id)return;if(window.__oc_btw_slash){window.__oc_btw_slash(arg,cur);return}n.toggle(\`btw:main\`,cur)}}));`,
    `e.add(${matchedSideExt},{id:\`main\`,region:\`side\`,normalize:()=>\`main\`,legacy:{btw:\`main\`},list:t=>t.open.length>0?[mainTab]:[],render:p=>${matchedF}(${matchedZeWrapper},{get children(){return ${matchedF}(t,{btw:i,get session(){return p.session},get id(){return\`main\`}})}})})`,
    "}",
  ].join("");

  out = out.slice(0, iStart) + replacementIse + out.slice(iEnd);

  // 3. Isolate ephemeral `ses_btw_*` SSE streaming sessions from main store & notifications
  if (out.includes("function de(e){switch(e.type){")) {
    out = out.replace(
      "function de(e){switch(e.type){",
      'function de(e){if(e?.data?.sessionID?.startsWith?.("ses_btw_"))return;switch(e.type){'
    );
  } else {
    out = out.replace(
      /function\s+([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\)\{switch\(\2\.type\)\{/,
      'function $1($2){if($2?.data?.sessionID?.startsWith?.("ses_btw_"))return;switch($2.type){'
    );
  }

  if (out.includes("D=e.sdk.event.listen(e=>{")) {
    out = out.replace(
      "D=e.sdk.event.listen(e=>{",
      'D=e.sdk.event.listen(e=>{if(e?.data?.sessionID?.startsWith?.("ses_btw_"))return;'
    );
  } else {
    out = out.replace(
      /([a-zA-Z0-9_$]+=)([a-zA-Z0-9_$]+)\.sdk\.event\.listen\(([a-zA-Z0-9_$]+)=>\{/,
      '$1$2.sdk.event.listen($3=>{if($3?.data?.sessionID?.startsWith?.("ses_btw_"))return;'
    );
  }

  // 4. Inject Codex-style sidebar with pinning into desktop vertical tabs
  const vTabsRegex = /([a-zA-Z0-9_$]+)\(\),\(\(\)=>\{var\s+([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(\);return\s+([a-zA-Z0-9_$]+)\(\2,([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+),(\{orientation:[`'"]vertical[`'"],[\s\S]+?\.reorder\([a-zA-Z0-9_$]+\)\})\)\),\2\}\)\(\)/;
  const vMatch = out.match(vTabsRegex);
  let vTabsInjected = false;
  if (vMatch) {
    const [full, prefixFn, cVar, hVar, insFn, crComp, i5Var, props] = vMatch;
    const tabsVar = props.match(/tabs:([a-zA-Z0-9_$]+)/)?.[1] || "_";
    const currentTabFn = props.match(/get currentTab\(\)\{return ([a-zA-Z0-9_$]+)\(\)\}/)?.[1] || "D";
    const tabsStoreVar = props.match(/onNavigate:\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)=>\{([a-zA-Z0-9_$]+)\.select/)?.[1] || "d";
    const tabKeyFn = props.match(/findIndex\([a-zA-Z0-9_$]+=>([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+\)===\1\(/)?.[1] || "AR";

    const settingsHookMatch = src.match(/var\{use:([a-zA-Z0-9_$]+),provider:([a-zA-Z0-9_$]+)\}=Yi\(\{name:[`'"]SettingsSurface[`'"]/);
    const settingsHook = settingsHookMatch ? settingsHookMatch[1] : "RU";
    const settingsProvider = settingsHookMatch ? settingsHookMatch[2] : "zU";

    const replacement = [
      `${prefixFn}(),(()=>{`,
      `var ${cVar}=${hVar}(),orig=${crComp}(${i5Var},${props}),host=document.createElement('div'),origWrap=document.createElement('div');`,
      "host.className='oc-cx-host-container flex min-h-0 flex-1 flex-col';",
      "origWrap.style.display='none';",
      `${insFn}(origWrap,orig);`,
      `var deps={servers:s,tabsStore:${tabsStoreVar},tabs:${tabsVar},current:()=>${currentTabFn}(),tabKey:${tabKeyFn},serverKey:Q.key,settings:(()=>{try{return ${settingsHook}()}catch(e){try{return ${settingsProvider}()}catch(e2){return null}}})(),locale:()=>{try{return r.locale?.()||r.language?.()}catch(e){return'zh'}}};`,
      // createComponent runs untracked: snapshot reads must not subscribe the sidebar's parent.
      "var cxDisposed=!1,cxDispose;",
      "__oc_cx_onCleanup(()=>{cxDisposed=!0;cxDispose?.()});",
      `var cxStart=m=>${crComp}(()=>{if(!cxDisposed)cxDispose=m.mount(host,deps)});`,
      "if(window.__oc_cx_sidebar?.mount){cxStart(window.__oc_cx_sidebar)}else{import('./sidebar-codex.js').then(m=>{window.__oc_cx_sidebar=m;cxStart(m)}).catch(err=>{console.error('[cx-sidebar]',err);origWrap.style.display='';host.style.display='none'})};",
      `return ${insFn}(${cVar},[host,origWrap]),${cVar};`,
      "})()",
    ].join("");

    out = out.slice(0, vMatch.index) + replacement + out.slice(vMatch.index + full.length);
    vTabsInjected = true;
  }

  if (vTabsInjected) {
    // Capture at module scope: the vertical-tab component shadows A with its UI store.
    out = `const __oc_cx_onCleanup=${matchedA};\n${out}`;
    console.log("[patch] 成功注入 Codex 侧边栏与置顶模块挂钩。");
  } else {
    console.warn("[patch] 警告：未能匹配垂直标签栏挂钩，跳过 Codex 侧边栏注入。");
  }

  return out;
}

function patchSessionRouteBundle(src, origMainSrc = "", symbols = {}) {
  let out = src;

  // 1. Allow right side panel to be resized down to 340px instead of 480px minimum
  out = out.replace(/var\s+([a-zA-Z0-9_$]+=)480(,[a-zA-Z0-9_$]+=800)/, "var $1340$2");

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
  const revealMatch = out.match(
    /e\.setRevealMessage\?\.\(\(([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)\)=>\{(?:if\(![a-zA-Z0-9_$]+\(\)\)return;)?let [a-zA-Z0-9_$]+=\2\?([a-zA-Z0-9_$]+)\(\)\.findIndex\([a-zA-Z0-9_$]+=>([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+,[`'"]AssistantPart[`'"]\)[^}]+?([a-zA-Z0-9_$]+)\.scrollToIndex/
  );
  if (revealMatch) {
    const itemsFn = revealMatch[3];
    const checkFn = revealMatch[4];
    const virtVar = revealMatch[5];
    const flusherMatch = revealMatch[0].match(/([a-zA-Z0-9_$]+)\(\),[a-zA-Z0-9_$]+\.scrollToIndex/);
    const flusherVar = flusherMatch ? flusherMatch[1] : "be";
    out = out.replace(
      "e.setRevealMessage?.((t,r)=>{",
      `window.__oc_virtual_scroll={M:${virtVar},be:${flusherVar},unpin:${flusherVar},getRowIndex:(t,r)=>{let i=r?${itemsFn}().findIndex(e=>${checkFn}(e,\`AssistantPart\`)&&e.group.type===\`part\`&&e.group.ref.partID===r):-1;return i>=0?i:e.projection.messageRowIndex().get(t)}},e.setRevealMessage?.((t,r)=>{`
    );
  } else {
    throw new Error("Could not locate e.setRevealMessage in route bundle.");
  }

  // 4. Inject "Branch to new chat" button next to copy button in assistant response footer
  const routeImportMatch = out.match(/import\{([^}]+)\}from["']\.\/main-[^"']+["']/);
  const routeImports = {};
  if (routeImportMatch) {
    for (const part of routeImportMatch[1].split(",")) {
      const [orig, local] = part.trim().split(/\s+as\s+/);
      routeImports[orig] = local || orig;
    }
  }

  const exportIdx = origMainSrc ? origMainSrc.lastIndexOf("export{") : -1;
  const exportsStr = exportIdx !== -1 ? origMainSrc.slice(exportIdx) : "";
  function getExportAlias(internalName) {
    if (!internalName) return null;
    const m = exportsStr.match(new RegExp(`\\b${internalName}\\s+as\\s+([a-zA-Z0-9_$]+)`));
    return m ? m[1] : null;
  }

  const sessionUrlInternal = origMainSrc?.match(/function\s+([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{return`\/server\/\$\{/)?.[1];
  const sessionUrlExport = getExportAlias(sessionUrlInternal);

  const sdkInternal = origMainSrc?.match(/var\s+([a-zA-Z0-9_$]+)=\(\)=>([a-zA-Z0-9_$]+)\(\)\.ctx\.sdk/);
  const sdkExport = getExportAlias(sdkInternal?.[1]);
  const srvExport = getExportAlias(sdkInternal?.[2]);

  const stInternal = origMainSrc?.match(/var\s+([a-zA-Z0-9_$]+)=\(\)=>[a-zA-Z0-9_$]+\(\)\.ctx\.data/)?.[1];
  const stExport = getExportAlias(stInternal);

  const navInternal = origMainSrc?.match(/([a-zA-Z0-9_$]+)=\(\)=>[a-zA-Z0-9_$]+\(\)\.navigatorFactory\(\)/)?.[1];
  const prmInternal = origMainSrc?.match(/([a-zA-Z0-9_$]+)=\(\)=>[a-zA-Z0-9_$]+\(\)\.params\b/)?.[1];
  const navExport = getExportAlias(navInternal);
  const prmExport = getExportAlias(prmInternal);

  const sigFn = (symbols?.createSignal && routeImports[symbols.createSignal]) || routeImports["bl"] || "en";
  const toastFn = routeImports["di"] || (symbols?.showToast && routeImports[symbols.showToast]) || "Ot";
  const sessionUrlFn = (sessionUrlExport && routeImports[sessionUrlExport]) || routeImports["Ir"] || "M";
  const sdkHook = (sdkExport && routeImports[sdkExport]) || routeImports["gi"] || "nt";
  const srvHook = (srvExport && routeImports[srvExport]) || routeImports["yi"] || "pt";
  const stHook = (stExport && routeImports[stExport]) || routeImports["vi"] || "Jn";
  const navHook = (navExport && routeImports[navExport]) || routeImports["Zs"] || "xn";
  const prmHook = (prmExport && routeImports[prmExport]) || routeImports["Qs"] || "Nn";

  const declRegex = /\[[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\]=[a-zA-Z0-9_$]+\(!1\),[a-zA-Z0-9_$]+=async\(\)=>\{await [a-zA-Z0-9_$]+\(e\.text\)&&\(.+?setTimeout\(.+?2e3\)\)\};/;
  const declMatch = out.match(declRegex);

  const jsxRegex = /var\s+([a-zA-Z0-9_$]+)=[a-zA-Z0-9_$]+\(\);return\s+([a-zA-Z0-9_$]+)\(\1,([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+),\{get icon\(\)\{return [a-zA-Z0-9_$]+\(\)\?`check`:`copy`\}.+?n\.t\([`'"]ui\.message\.copyResponse[`'"]\).*?\}\),null\),/;
  const jsxMatch = out.match(jsxRegex);

  if (!declMatch || !jsxMatch) {
    throw new Error("Could not locate assistant message copy footer in route bundle.");
  }

  const containerVar = jsxMatch[1];
  const insertFn = jsxMatch[2];
  const createCompFn = jsxMatch[3];
  const iconBtnComp = jsxMatch[4];

  const declInject = [
    declMatch[0],
    `let _oc_sdk,_oc_srv,_oc_st,_oc_nav,_oc_prm;`,
    `try{_oc_sdk=${sdkHook}()}catch(e){}`,
    `try{_oc_srv=${srvHook}()}catch(e){}`,
    `try{_oc_st=${stHook}()}catch(e){}`,
    `try{_oc_nav=${navHook}()}catch(e){}`,
    `try{_oc_prm=${prmHook}()}catch(e){}`,
    `let [__oc_fk_l,__oc_set_fk_l]=${sigFn}(!1),`,
    `__oc_fork=async(evt)=>{`,
    `if(evt){evt.preventDefault?.();evt.stopPropagation?.()}`,
    `if(__oc_fk_l())return;`,
    `let sId=_oc_prm?.id||window.__oc_current_session?.identity?.sessionID?.()||window.__oc_current_session?.identity?.params?.id||window.__oc_timeline_ctrl?.sessionID?.()||window.__oc_app_ext?.sessions?.current?.()?.id;`,
    `if(!sId){`,
    `${toastFn}({title:n.t('common.requestFailed')||'请求失败',description:'未找到当前会话ID'});`,
    `return;`,
    `}`,
    `__oc_set_fk_l(!0);`,
    `try{`,
    `let sdk=_oc_sdk||window.__oc_app_ext?.sdk;`,
    `let srv=_oc_srv;`,
    `let st=_oc_st;`,
    `let nav=_oc_nav;`,
    `let srvKey=srv?.key||window.__oc_current_session?.identity?.params?.serverKey||'local';`,
    `if(!sdk?.api?.session?.fork)throw new Error('Fork API 未就绪');`,
    `let msgs=st?.session?.message?.list?.(sId)||[];`,
    `let cIdx=msgs.findIndex(m=>m.id===e.message.id);`,
    `let bId=void 0;`,
    `if(cIdx!==-1){let nu=msgs.slice(cIdx+1).find(m=>m.type==='user');nu&&(bId=nu.id)}`,
    `let fk=await sdk.api.session.fork({sessionID:sId,before:bId});`,
    `if(fk?.id){`,
    `let curS=st?.session?.get?.(sId)||window.__oc_current_session?.data?.info?.();`,
    `let isZh=n.locale()?.startsWith('zh')??!0,tag=isZh?'分支':'Branch';`,
    `let rawT=curS?.title||(isZh?'新会话':'New Session');`,
    `let clnT=rawT.replace(/\\s*\\((?:分支(?:\\s*\\d+)?|branch(?:\\s*\\d+)?|fork(?:\\s*#?\\d+)?)\\)$/i,'').trim();`,
    `let allS=st?.session?.list?.()||[];`,
    'let esc=clnT.replace(/[.*+?^${}()|[\\]\\\\]/g,\'\\\\$&\');',
    `let bRe=new RegExp('^'+esc+' \\\\('+tag+'(?: (\\\\d+))?\\\\)$'),has1=!1,maxN=1;`,
    `for(let s of allS){if(!s?.title)continue;let m=s.title.match(bRe);m&&(m[1]===void 0?has1=!0:(maxN=Math.max(maxN,parseInt(m[1],10))))}`,
    `let nTitle=!has1?(clnT+' ('+tag+')'):(clnT+' ('+tag+' '+(maxN+1)+')');`,
    `await sdk.api.session.update({sessionID:fk.id,title:nTitle}).catch(()=>{});`,
    `fk.title=nTitle;`,
    `st?.session?.remember?.(fk);`,
    `if(nav){nav(${sessionUrlFn}(srvKey,fk.id))}else{window.location.hash=${sessionUrlFn}(srvKey,fk.id)}`,
    `}`,
    `}catch(err){`,
    `let msg=err instanceof Error?err.message:String(err);`,
    `${toastFn}({title:n.t('common.requestFailed')||'请求失败',description:msg});`,
    `}finally{`,
    `__oc_set_fk_l(!1);`,
    `}`,
    `},`,
    `__oc_fork_lbl=()=>{`,
    `let isZh=n.locale()?.startsWith('zh')??!0;`,
    `return __oc_fk_l()?(isZh?'正在分支...':'Branching...'):(isZh?'分支到新聊天':'Branch to new chat');`,
    `};`
  ].join("");

  const branchJsx = `${insertFn}(${containerVar},${createCompFn}(${iconBtnComp},{icon:\`fork\`,get label(){return __oc_fork_lbl()},get disabled(){return __oc_fk_l()},onMouseDown:e=>e.preventDefault(),onClick:__oc_fork,get"aria-label"(){return __oc_fork_lbl()}}),null),`;

  out = out.replace(declMatch[0], () => declInject);
  out = out.replace(jsxMatch[0], () => `${jsxMatch[0]}${branchJsx}`);

  return out;
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force") || args.includes("-f");
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
    fs.copyFileSync(bakPath, asarPath);
    console.log(`[restore] 成功从官方备份恢复：${bakPath} -> ${asarPath}`);
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
  ${symbols.onChange} as onChange,
  ${symbols.Tooltip} as Tooltip,
  ${symbols.useExtension} as useExtension,
  ${symbols.IconButton} as IconButton,
  ${symbols.createMemo} as createMemo,
  ${symbols.ScrollView} as ScrollView,
  ${symbols.Show} as Show,
  ${symbols.Icon} as Icon,
  ${symbols.Match} as Match,
  ${symbols.memoBool} as memoBool,
  ${symbols.Button} as Button,
  ${symbols.createSignal} as createSignal,
  ${symbols.showToast} as showToast,
  ${symbols.insert} as insert,
  ${symbols.template} as template,
  ${symbols.Switch} as Switch,
  ${symbols.createComponent} as createComponent,
  ${symbols.For} as For,
  ${symbols.createEffect} as createEffect,
  ${symbols.onCleanup} as onCleanup,
} from "./${mainFileName}";`;

  customPanelSrc = customPanelSrc.replace(oldImportsRegex, newImports);

  // Extract the exact markdown and text-shimmer chunks used by the target panel
  const mdMatch = origPanelSrc.match(/from\s*["']\.\/(markdown-[^"']+)["']/);
  const shMatch = origPanelSrc.match(/from\s*["']\.\/(text-shimmer-[^"']+)["']/);
  const markdownFileName =
    mdMatch?.[1] ||
    Object.keys(assetsMap).find((k) => /^markdown-[A-Za-z0-9_-]+\.js$/.test(k)) ||
    "markdown.js";
  const shimmerFileName =
    shMatch?.[1] ||
    Object.keys(assetsMap).find((k) => /^text-shimmer-[A-Za-z0-9_-]+\.js$/.test(k)) ||
    "text-shimmer.js";

  customPanelSrc = customPanelSrc.replace(
    /import\s*\{[^}]*\}\s*from\s*["']\.\/markdown-[^"']+["']/,
    `import { t as Markdown } from "./${markdownFileName}"`
  );
  customPanelSrc = customPanelSrc.replace(
    /import\s*\{[^}]*\}\s*from\s*["']\.\/text-shimmer-[^"']+["']/,
    `import { t as TextShimmer } from "./${shimmerFileName}"`
  );

  const patchedMainBuf = Buffer.from(`import "./voice-input.mjs";\n` + patchMainBundle(origMainSrc, targetPanelFileName, origPanelSrc), "utf8");
  const patchedRouteBuf = Buffer.from(patchSessionRouteBundle(origRouteSrc, origMainSrc, symbols), "utf8");
  const patchedPanelBuf = Buffer.from(customPanelSrc, "utf8");

  const customSidebarSrc = fs.readFileSync(customSidebarPath, "utf8");
  const patchedSidebarBuf = Buffer.from(customSidebarSrc, "utf8");
  const sidebarFileName = "sidebar-codex.js";

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
  let currentOffset = payload.length;

  assetsMap[mainFileName] = {
    size: patchedMainBuf.length,
    offset: String(currentOffset),
    integrity: computeIntegrity(patchedMainBuf),
  };
  currentOffset += patchedMainBuf.length;

  assetsMap[routeFileName] = {
    size: patchedRouteBuf.length,
    offset: String(currentOffset),
    integrity: computeIntegrity(patchedRouteBuf),
  };
  currentOffset += patchedRouteBuf.length;

  assetsMap[targetPanelFileName] = {
    size: patchedPanelBuf.length,
    offset: String(currentOffset),
    integrity: computeIntegrity(patchedPanelBuf),
  };
  currentOffset += patchedPanelBuf.length;

  assetsMap[sidebarFileName] = {
    size: patchedSidebarBuf.length,
    offset: String(currentOffset),
    integrity: computeIntegrity(patchedSidebarBuf),
  };
  currentOffset += patchedSidebarBuf.length;

  for (const [map, name, buffer] of voiceFiles) {
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
    patchedMainBuf,
    patchedRouteBuf,
    patchedPanelBuf,
    patchedSidebarBuf,
    ...voiceFiles.map(([, , buffer]) => buffer),
  ]);

  fs.writeFileSync(asarPath, finalAsarBuf);
  console.log(`\n[patch] 成功完成补丁写入！`);
  console.log(`[patch] 目标文件：${asarPath} (${finalAsarBuf.length} 字节)`);
  console.log(`[patch] 官方原版备份保留在：${bakPath}`);
  console.log(`[patch] 现在可启动 OpenCode 桌面端尽情体验增强功能。\n`);
}

main();
