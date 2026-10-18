#!/usr/bin/env node
/**
 * OpenCode Desktop UI Enhancement Patcher
 * Cross-platform patcher for Windows, macOS, and Linux
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
 *
 * Usage:
 *   node apply-mod.mjs            # Apply patch to OpenCode Desktop app.asar
 *   node apply-mod.mjs --restore  # Restore official app.asar from backup
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const customPanelPath = path.join(__dirname, "panel-c7bWJg2T.js");

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

function ensureOpenCodeClosed() {
  const procName = process.platform === "win32" ? "OpenCode.exe" : "OpenCode";
  if (isProcessRunning(procName)) {
    console.error(`\n[错误] 检测到 OpenCode 桌面端正在运行 (${procName})！`);
    console.error(`[提示] 为避免 app.asar 文件句柄被系统占用锁定 (EBUSY)，请先完全关闭 OpenCode 后再执行此脚本。\n`);
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
      mainBuf.includes(Buffer.from("/btw 随时问答"))
    );
  } catch {
    return false;
  }
}

function patchMainBundle(src, panelFileName = "panel-c7bWJg2T.js") {
  let out = src;

  // 1. Widen default session-chat-panel width when right side panel is opened (600 -> 1080)
  if (out.includes("tR=344,nR=200,rR=600,iR=280")) {
    out = out.replace("tR=344,nR=200,rR=600,iR=280", "tR=344,nR=200,rR=1080,iR=280");
  } else {
    out = out.replace(
      /([a-zA-Z0-9_$]+=344,[a-zA-Z0-9_$]+=200,)([a-zA-Z0-9_$]+=)600(,[a-zA-Z0-9_$]+=280)/,
      "$1$21080$3"
    );
  }

  // 2. Upgrade Ise (the built-in `btw` extension setup)
  const iseStartMarker = `Ise=e=>{let t=Re(()=>G(()=>import(\`./${panelFileName}\`)`;
  const iseStartRegex = new RegExp(
    `([a-zA-Z0-9_$]+)=e=>\\{let ([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\\(\\(\\)=>([a-zA-Z0-9_$]+)\\(\\(\\)=>import\\([\\\`'"]\\.\\/${panelFileName.replace(".", "\\.")}[\\\`'"]\\)(?:,[^)]+)?\\)`
  );
  const iseEndMarker = "close:e=>{i.remove(e.session,e.tab.id),o.get(e.session.key)?.delete(e.tab.id)}})}";

  let iStart = out.indexOf(iseStartMarker);
  let matchedIseName = "Ise";
  let matchedRe = "Re";
  let matchedG = "G";

  if (iStart === -1) {
    const m = out.match(iseStartRegex);
    if (m && m.index !== undefined) {
      iStart = m.index;
      matchedIseName = m[1];
      matchedRe = m[3];
      matchedG = m[4];
    }
  }

  let iEnd = iStart !== -1 ? out.indexOf(iseEndMarker, iStart) : -1;
  let endMarkerLen = iseEndMarker.length;

  if (iStart === -1 || iEnd === -1) {
    // Try generic regex search for Ise function block
    const fallbackMatch = out.match(
      /([a-zA-Z0-9_$]+)=e=>\{let t=[a-zA-Z0-9_$]+\(\(\)=>[a-zA-Z0-9_$]+\(\(\)=>import\([`'"]\.\/panel-[^`'"]+[`'"]\)[^}]+close:[a-zA-Z0-9_$]+=>\{[^}]+\}\}\)\}/
    );
    if (fallbackMatch && fallbackMatch.index !== undefined) {
      iStart = fallbackMatch.index;
      iEnd = iStart + fallbackMatch[0].length;
      endMarkerLen = 0;
    } else {
      throw new Error("Could not locate Ise (btw extension setup) in main bundle.");
    }
  }

  // Extract vite dependency mapping array if present in original import
  const origSnippet = out.slice(iStart, Math.min(out.length, iStart + 250));
  const mapDepsMatch = origSnippet.match(/__vite__mapDeps\(\[([0-9,\s]+)\]\)/);
  const mapDepsArg = mapDepsMatch ? `__vite__mapDeps([${mapDepsMatch[1]}]),` : "";

  const replacementIse = [
    `${matchedIseName}=e=>{`,
    "window.__oc_app_ext=e;",
    `let t=${matchedRe}(()=>${matchedG}(()=>import(\`./${panelFileName}\`),${mapDepsArg}import.meta.url));`,
    "A(NI(()=>void t.preload()));",
    `${matchedG}(()=>import(\`./${panelFileName}\`),${mapDepsArg}import.meta.url).then(m=>m.initCompanion?.(e));`,
    "let n=e.layout,r=e.sessions,i=Pse(e),a=E(()=>!!r.current()),",
    "mainTab={id:`main`,get title(){return`/btw`},draggable:!1,closable:`compact`,fallback:!0,label:()=>((()=>{var r=Fse(),a=r.firstChild;return H(r,F(jP,{name:`bubble-5`,size:`small`}),a),H(a,()=>`/btw`),r})())};",
    "e.add(CI,{at:`session.header`,order:15,render:p=>{r7(()=>p.session);return F(R,{get when(){return p.session.id},get children(){return F(hH,{value:`/btw 随时问答 (Alt+B)`,placement:`bottom`,get children(){return F(wH,{type:`button`,variant:`ghost-muted`,class:`group shrink-0`,style:{padding:`0 6px`,color:`var(--v2-text-text-faint)`},onClick:()=>{p.session.id&&n.toggle(`btw:main`,p.session)},get\"aria-expanded\"(){return n.state(`btw:main`,p.session)===`visible`},\"aria-label\":`/btw 随时问答`,get children(){var el=Fse(),sp=el.firstChild;return H(el,F(jP,{name:`bubble-5`,size:`small`}),sp),H(sp,()=>`/btw`),el}})}})}})}});",
    "e.add(gI,()=>({id:`ask`,title:`/btw 随时问答`,description:`打开右侧多轮问答面板，支持划词引用、自由切换模型与上下文控制`,group:e.t(`command.category.session`),section:`session`,bind:`alt+b`,slash:{name:`btw`,arguments:!0},enabled:!n.narrow()&&a(),run:arg=>{let cur=r.current();if(!cur?.id)return;if(window.__oc_btw_slash){window.__oc_btw_slash(arg,cur);return}n.toggle(`btw:main`,cur)}}));",
    "e.add(vI,{id:`main`,region:`side`,normalize:()=>`main`,legacy:{btw:`main`},list:t=>t.open.length>0?[mainTab]:[],render:p=>F(Je,{get children(){return F(t,{btw:i,get session(){return p.session},get id(){return`main`}})}})})",
    "}",
  ].join("");

  out = out.slice(0, iStart) + replacementIse + out.slice(iEnd + endMarkerLen);

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

  return out;
}

function patchSessionRouteBundle(src) {
  let out = src;

  // 1. Allow right side panel to be resized down to 340px instead of 480px minimum
  if (out.includes("var t_=480,n_=800")) {
    out = out.replace("var t_=480,n_=800", "var t_=340,n_=800");
  } else {
    out = out.replace(/var\s+([a-zA-Z0-9_$]+=)480(,[a-zA-Z0-9_$]+=800)/, "var $1340$2");
  }

  // 2. Expose timeline controller `p=mv(t)` on `window.__oc_timeline_ctrl` for virtual-scroll navigation
  if (out.includes("p=mv(t),m=Sv(")) {
    out = out.replace("p=mv(t),m=Sv(", "p=(window.__oc_current_session=t,window.__oc_timeline_ctrl=mv(t)),m=Sv(");
  } else {
    const mvMatch = out.match(/([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\),([a-zA-Z0-9_$]+=)([a-zA-Z0-9_$]+)\(\3\)/);
    if (mvMatch) {
      const origCtrlVar = mvMatch[1];
      const fnMv = mvMatch[2];
      const sessVar = mvMatch[3];
      out = out.replace(
        mvMatch[0],
        `${origCtrlVar}=(window.__oc_current_session=${sessVar},window.__oc_timeline_ctrl=${fnMv}(${sessVar})),${mvMatch[4]}${mvMatch[5]}(${sessVar})`
      );
    } else {
      throw new Error("Could not locate p=mv(t),m=Sv( in route bundle.");
    }
  }

  // 3. Expose virtualizer instance M and scrollAdjustment flusher be() on window.__oc_virtual_scroll
  const revealMarker = "e.setRevealMessage?.((t,r)=>{";
  if (out.includes(revealMarker)) {
    out = out.replace(
      revealMarker,
      "window.__oc_virtual_scroll={M,be,getRowIndex:(t,r)=>{let i=r?y().findIndex(e=>W(e,`AssistantPart`)&&e.group.type===`part`&&e.group.ref.partID===r):-1;return i>=0?i:e.projection.messageRowIndex().get(t)}},e.setRevealMessage?.((t,r)=>{"
    );
  } else {
    throw new Error("Could not locate e.setRevealMessage in route bundle.");
  }

  // 4. Inject "Branch to new chat" (分支到新聊天) button next to copy button in assistant response footer
  const declTarget = "[l,u]=en(!1),d=async()=>{await af(e.text)&&(u(!0),setTimeout(()=>u(!1),2e3))};";
  const declInject = [
    "[l,u]=en(!1),d=async()=>{await af(e.text)&&(u(!0),setTimeout(()=>u(!1),2e3))};",
    "let _oc_sdk,_oc_srv,_oc_st,_oc_nav,_oc_prm;",
    "try{_oc_sdk=nt()}catch(e){}",
    "try{_oc_srv=pt()}catch(e){}",
    "try{_oc_st=Jn()}catch(e){}",
    "try{_oc_nav=xn()}catch(e){}",
    "try{_oc_prm=Nn()}catch(e){}",
    "let [__oc_fk_l,__oc_set_fk_l]=en(!1),",
    "__oc_fork=async(evt)=>{",
    "if(evt){evt.preventDefault?.();evt.stopPropagation?.()}",
    "if(__oc_fk_l())return;",
    "let sId=_oc_prm?.id||window.__oc_current_session?.identity?.sessionID?.()||window.__oc_current_session?.identity?.params?.id||window.__oc_timeline_ctrl?.sessionID?.()||window.__oc_app_ext?.sessions?.current?.()?.id;",
    "if(!sId){",
    "Ot({title:n.t('common.requestFailed')||'请求失败',description:'未找到当前会话ID'});",
    "return;",
    "}",
    "__oc_set_fk_l(!0);",
    "try{",
    "let sdk=_oc_sdk||window.__oc_app_ext?.sdk;",
    "let srv=_oc_srv;",
    "let st=_oc_st;",
    "let nav=_oc_nav;",
    "let srvKey=srv?.key||window.__oc_current_session?.identity?.params?.serverKey||'local';",
    "if(!sdk?.api?.session?.fork)throw new Error('Fork API 未就绪');",
    "let msgs=st?.session?.message?.list?.(sId)||[];",
    "let cIdx=msgs.findIndex(m=>m.id===e.message.id);",
    "let bId=void 0;",
    "if(cIdx!==-1){let nu=msgs.slice(cIdx+1).find(m=>m.type==='user');nu&&(bId=nu.id)}",
    "let fk=await sdk.api.session.fork({sessionID:sId,before:bId});",
    "if(fk?.id){",
    "let curS=st?.session?.get?.(sId)||window.__oc_current_session?.data?.info?.();",
    "let isZh=n.locale()?.startsWith('zh')??!0,tag=isZh?'分支':'Branch';",
    "let rawT=curS?.title||(isZh?'新会话':'New Session');",
    "let clnT=rawT.replace(/\\s*\\((?:分支(?:\\s*\\d+)?|branch(?:\\s*\\d+)?|fork(?:\\s*#?\\d+)?)\\)$/i,'').trim();",
    "let allS=st?.session?.list?.()||[];",
    "let esc=clnT.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&');",
    "let bRe=new RegExp('^'+esc+' \\\\('+tag+'(?: (\\\\d+))?\\\\)$'),has1=!1,maxN=1;",
    "for(let s of allS){if(!s?.title)continue;let m=s.title.match(bRe);m&&(m[1]===void 0?has1=!0:(maxN=Math.max(maxN,parseInt(m[1],10))))}",
    "let nTitle=!has1?(clnT+' ('+tag+')'):(clnT+' ('+tag+' '+(maxN+1)+')');",
    "await sdk.api.session.update({sessionID:fk.id,title:nTitle}).catch(()=>{});",
    "fk.title=nTitle;",
    "st?.session?.remember?.(fk);",
    "if(nav){nav(M(srvKey,fk.id))}else{window.location.hash=M(srvKey,fk.id)}",
    "}",
    "}catch(err){",
    "let msg=err instanceof Error?err.message:String(err);",
    "Ot({title:n.t('common.requestFailed')||'请求失败',description:msg});",
    "}finally{",
    "__oc_set_fk_l(!1);",
    "}",
    "},",
    "__oc_fork_lbl=()=>{",
    "let isZh=n.locale()?.startsWith('zh')??!0;",
    "return __oc_fk_l()?(isZh?'正在分支...':'Branching...'):(isZh?'分支到新聊天':'Branch to new chat');",
    "};",
  ].join("");

  const jsxTarget =
    'var e=ef();return G(e,X(sf,{get icon(){return l()?`check`:`copy`},get label(){return B(()=>!!l())()?n.t(`ui.message.copied`):n.t(`ui.message.copyResponse`)},onMouseDown:e=>e.preventDefault(),onClick:d,get"aria-label"(){return B(()=>!!l())()?n.t(`ui.message.copied`):n.t(`ui.message.copyResponse`)}}),null),G(e,X(R,{get when(){return c()},get children(){var e=$d();return G(e,c),e}}),null),x(()=>U(e,`data-interrupted`,i()?``:void 0)),e';

  const jsxInject = [
    'var e=ef();return ',
    'G(e,X(sf,{get icon(){return l()?`check`:`copy`},get label(){return B(()=>!!l())()?n.t(`ui.message.copied`):n.t(`ui.message.copyResponse`)},onMouseDown:e=>e.preventDefault(),onClick:d,get"aria-label"(){return B(()=>!!l())()?n.t(`ui.message.copied`):n.t(`ui.message.copyResponse`)}}),null),',
    'G(e,X(sf,{icon:`fork`,get label(){return __oc_fork_lbl()},get disabled(){return __oc_fk_l()},onMouseDown:e=>e.preventDefault(),onClick:__oc_fork,get"aria-label"(){return __oc_fork_lbl()}}),null),',
    'G(e,X(R,{get when(){return c()},get children(){var e=$d();return G(e,c),e}}),null),',
    'x(()=>U(e,`data-interrupted`,i()?``:void 0)),',
    'e',
  ].join("");

  if (out.includes(declTarget) && out.includes(jsxTarget)) {
    out = out.replace(declTarget, () => declInject).replace(jsxTarget, () => jsxInject);
  } else {
    throw new Error("Could not locate assistant message copy footer in route bundle.");
  }

  return out;
}

function main() {
  const args = process.argv.slice(2);
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

  // Ensure OpenCode process is closed before modifying files
  ensureOpenCodeClosed();

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
  if (targetVersion !== "2.0.32" && targetVersion !== "unknown") {
    console.log(`[提示] 本补丁在 v2.0.32 下经过完整验证。如果在新版本下遇到匹配错误，可运行 --restore 恢复。`);
  }

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

  // Dynamically detect the btw panel chunk name referenced by main bundle
  const panelRefMatch = origMainSrc.match(/import\([`'"]\.\/(panel-[A-Za-z0-9_-]+\.js)[`'"]\)/);
  const targetPanelFileName = panelRefMatch ? panelRefMatch[1] : "panel-c7bWJg2T.js";

  if (!assetsMap[targetPanelFileName]) {
    throw new Error(`Missing expected btw panel asset: ${targetPanelFileName}`);
  }

  console.log(`[patch] 定位关键模块文件:`);
  console.log(`  - 主包入口 (Main):   ${mainFileName}`);
  console.log(`  - 会话路由 (Route):  ${routeFileName}`);
  console.log(`  - 问答面板 (Panel):  ${targetPanelFileName}`);

  let customPanelSrc = fs.readFileSync(customPanelPath, "utf8");

  // Dynamically rewrite imports in custom panel to match the user's specific bundle chunk hashes
  customPanelSrc = customPanelSrc.replace(/\.\/main-[A-Za-z0-9_-]+\.js/g, `./${mainFileName}`);

  const markdownFileName = Object.keys(assetsMap).find((k) => {
    if (!/^markdown-[A-Za-z0-9_-]+\.js$/.test(k)) return false;
    const node = assetsMap[k];
    const src = readFileFromAsar(payload, node);
    // The markdown rendering component exports `t` (e.g. `ki as t` or `as t`)
    return src.includes("as t") || src.includes(",t}") || src.includes("t as");
  }) || Object.keys(assetsMap).find((k) => /^markdown-[A-Za-z0-9_-]+\.js$/.test(k));
  if (markdownFileName) {
    customPanelSrc = customPanelSrc.replace(/\.\/markdown-[A-Za-z0-9_-]+\.js/g, `./${markdownFileName}`);
  }

  const shimmerFileName = Object.keys(assetsMap).find((k) => /^text-shimmer-[A-Za-z0-9_-]+\.js$/.test(k));
  if (shimmerFileName) {
    customPanelSrc = customPanelSrc.replace(/\.\/text-shimmer-[A-Za-z0-9_-]+\.js/g, `./${shimmerFileName}`);
  }

  const patchedMainBuf = Buffer.from(patchMainBundle(origMainSrc, targetPanelFileName), "utf8");
  const patchedRouteBuf = Buffer.from(patchSessionRouteBundle(origRouteSrc), "utf8");
  const patchedPanelBuf = Buffer.from(customPanelSrc, "utf8");

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
  ]);

  fs.writeFileSync(asarPath, finalAsarBuf);
  console.log(`\n[patch] 成功完成补丁写入！`);
  console.log(`[patch] 目标文件：${asarPath} (${finalAsarBuf.length} 字节)`);
  console.log(`[patch] 官方原版备份保留在：${bakPath}`);
  console.log(`[patch] 现在可启动 OpenCode 桌面端尽情体验增强功能。\n`);
}

main();
