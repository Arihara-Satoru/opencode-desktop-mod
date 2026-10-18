#!/usr/bin/env node
/**
 * OpenCode Desktop UI Enhancement Patcher (v2.0.32+)
 *
 * Features injected:
 * 1. Left Session Timeline Navigation Bar (会话时间轴导航条)
 *    - Displays all user turns (#1, #2, ...) and Assistant Markdown headings (H1~H3)
 *    - Works seamlessly with OpenCode's virtualized timeline scroller
 *    - Supports keyword filtering, heading toggle, collapse to mini-rail, Top/Bottom jump
 * 2. Upgraded /btw Side Q&A Companion Panel (右侧可随时解答疑问的对话框)
 *    - Top-right header toggle button (`/btw`) & `Alt+B` shortcut
 *    - Text selection floating button (`💬 引用到 /btw` / `⚡ 直接解释`, or `Alt+Q`)
 *    - Free model selection (`client.model.list()`) independent of main session
 *    - Context scope control: `⚡ 仅引用/小窗` (default, no main context bloat) / `🔗 最近3轮` / `📚 完整主会话`
 *    - Continuous multi-turn conversation with persistent storage (closing panel never deletes history)
 *
 * Usage:
 *   node apply-mod.mjs            # Apply patch to OpenCode Desktop app.asar
 *   node apply-mod.mjs --restore  # Restore original app.asar from app.asar.bak
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_ASAR_PATH = path.join(
  process.env.LOCALAPPDATA || "C:/Users/satira/AppData/Local",
  "Programs",
  "@opencode-aidesktop",
  "resources",
  "app.asar"
);

const asarPath = process.env.OPENCODE_ASAR_PATH || DEFAULT_ASAR_PATH;
const bakPath = `${asarPath}.bak`;
const customPanelPath = path.join(__dirname, "panel-c7bWJg2T.js");

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

function patchMainBundle(src) {
  let out = src;

  // 1. Widen default session-chat-panel width when right side panel is opened (600 -> 1080)
  if (out.includes("tR=344,nR=200,rR=600,iR=280")) {
    out = out.replace("tR=344,nR=200,rR=600,iR=280", "tR=344,nR=200,rR=1080,iR=280");
  }

  // 2. Upgrade Ise (the built-in `btw` extension setup)
  const iseStartMarker = "Ise=e=>{let t=Re(()=>G(()=>import(`./panel-c7bWJg2T.js`)";
  const iseEndMarker = "close:e=>{i.remove(e.session,e.tab.id),o.get(e.session.key)?.delete(e.tab.id)}})}";

  const iStart = out.indexOf(iseStartMarker);
  const iEnd = out.indexOf(iseEndMarker, iStart);
  if (iStart === -1 || iEnd === -1) {
    throw new Error("Could not locate Ise (btw extension setup) in main bundle.");
  }

  const replacementIse = [
    "Ise=e=>{",
    "let t=Re(()=>G(()=>import(`./panel-c7bWJg2T.js`),__vite__mapDeps([28,17,18,29,30]),import.meta.url));",
    "A(NI(()=>void t.preload()));",
    "G(()=>import(`./panel-c7bWJg2T.js`),__vite__mapDeps([28,17,18,29,30]),import.meta.url).then(m=>m.initCompanion?.(e));",
    "let n=e.layout,r=e.sessions,i=Pse(e),a=E(()=>!!r.current()),",
    "mainTab={id:`main`,get title(){return`/btw`},draggable:!1,closable:`compact`,fallback:!0,label:()=>((()=>{var r=Fse(),a=r.firstChild;return H(r,F(jP,{name:`bubble-5`,size:`small`}),a),H(a,()=>`/btw`),r})())};",
    "e.add(CI,{at:`session.header`,order:15,render:p=>{r7(()=>p.session);return F(R,{get when(){return p.session.id},get children(){return F(hH,{value:`/btw 随时问答 (Alt+B)`,placement:`bottom`,get children(){return F(wH,{type:`button`,variant:`ghost-muted`,class:`group shrink-0`,style:{padding:`0 6px`,color:`var(--v2-text-text-faint)`},onClick:()=>{p.session.id&&n.toggle(`btw:main`,p.session)},get\"aria-expanded\"(){return n.state(`btw:main`,p.session)===`visible`},\"aria-label\":`/btw 随时问答`,get children(){var el=Fse(),sp=el.firstChild;return H(el,F(jP,{name:`bubble-5`,size:`small`}),sp),H(sp,()=>`/btw`),el}})}})}})}});",
    "e.add(gI,()=>({id:`ask`,title:`/btw 随时问答`,description:`打开右侧多轮问答面板，支持划词引用、自由切换模型与上下文控制`,group:e.t(`command.category.session`),section:`session`,bind:`alt+b`,slash:{name:`btw`,arguments:!0},enabled:!n.narrow()&&a(),run:arg=>{let cur=r.current();if(!cur?.id)return;if(window.__oc_btw_slash){window.__oc_btw_slash(arg,cur);return}n.toggle(`btw:main`,cur)}}));",
    "e.add(vI,{id:`main`,region:`side`,normalize:()=>`main`,legacy:{btw:`main`},list:t=>t.open.length>0?[mainTab]:[],render:p=>F(Je,{get children(){return F(t,{btw:i,get session(){return p.session},get id(){return`main`}})}})})",
    "}",
  ].join("");

  out = out.slice(0, iStart) + replacementIse + out.slice(iEnd + iseEndMarker.length);

  // 3. Isolate ephemeral `ses_btw_*` SSE streaming sessions from main store & notifications
  if (out.includes("function de(e){switch(e.type){")) {
    out = out.replace(
      "function de(e){switch(e.type){",
      'function de(e){if(e?.data?.sessionID?.startsWith?.("ses_btw_"))return;switch(e.type){'
    );
  }
  if (out.includes("D=e.sdk.event.listen(e=>{")) {
    out = out.replace(
      "D=e.sdk.event.listen(e=>{",
      'D=e.sdk.event.listen(e=>{if(e?.data?.sessionID?.startsWith?.("ses_btw_"))return;'
    );
  }

  return out;
}

function patchSessionRouteBundle(src) {
  let out = src;

  // 1. Allow right side panel to be resized down to 340px instead of 480px minimum
  if (out.includes("var t_=480,n_=800")) {
    out = out.replace("var t_=480,n_=800", "var t_=340,n_=800");
  }

  // 2. Expose timeline controller `p=mv(t)` on `window.__oc_timeline_ctrl` for virtual-scroll navigation
  if (out.includes("p=mv(t),m=Sv(")) {
    out = out.replace("p=mv(t),m=Sv(", "p=(window.__oc_timeline_ctrl=mv(t)),m=Sv(");
  } else {
    throw new Error("Could not locate p=mv(t),m=Sv( in route bundle.");
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

  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--restore")) {
    if (!fs.existsSync(bakPath)) {
      console.error(`[restore] Backup not found at ${bakPath}`);
      process.exit(1);
    }
    fs.copyFileSync(bakPath, asarPath);
    console.log(`[restore] Restored original app.asar from ${bakPath}`);
    return;
  }

  if (!fs.existsSync(asarPath)) {
    console.error(`[patch] app.asar not found at ${asarPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(bakPath)) {
    console.log(`[patch] Creating backup at ${bakPath} ...`);
    fs.copyFileSync(asarPath, bakPath);
  } else {
    console.log(`[patch] Using clean backup from ${bakPath} as base ...`);
  }

  const rawAsar = fs.readFileSync(bakPath);
  const { header, payload } = parseAsar(rawAsar);
  const assetsMap = header?.files?.out?.files?.renderer?.files?.assets?.files;
  if (!assetsMap) {
    throw new Error("Could not find out/renderer/assets in app.asar header.");
  }

  const mainFileName = Object.keys(assetsMap).find((k) => /^main-[A-Za-z0-9_-]+\.js$/.test(k));
  const routeFileName = Object.keys(assetsMap).find(
    (k) => /^route-[A-Za-z0-9_-]+\.js$/.test(k) && assetsMap[k].size > 200000
  );
  const panelFileName = "panel-c7bWJg2T.js";

  if (!mainFileName || !routeFileName || !assetsMap[panelFileName]) {
    throw new Error(
      `Missing expected asset files: main=${mainFileName}, route=${routeFileName}, panel=${panelFileName}`
    );
  }

  console.log(`[patch] Target assets:`);
  console.log(`  - Main bundle:  ${mainFileName}`);
  console.log(`  - Route bundle: ${routeFileName}`);
  console.log(`  - BTW panel:    ${panelFileName}`);

  const origMainSrc = readFileFromAsar(payload, assetsMap[mainFileName]).toString("utf8");
  const origRouteSrc = readFileFromAsar(payload, assetsMap[routeFileName]).toString("utf8");
  let customPanelSrc = fs.readFileSync(customPanelPath, "utf8");

  // Ensure import filename in panel-c7bWJg2T.js matches mainFileName
  customPanelSrc = customPanelSrc.replace(/\.\/main-[A-Za-z0-9_-]+\.js/g, `./${mainFileName}`);

  const patchedMainBuf = Buffer.from(patchMainBundle(origMainSrc), "utf8");
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

  assetsMap[panelFileName] = {
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
  console.log(`[patch] Successfully wrote patched app.asar (${finalAsarBuf.length} bytes).`);
}

main();
