import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolvePanelSymbols, resolveTooltipSymbol, resolvePanelChunkImport } from "./bundle-symbols.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const patcher = fs.readFileSync(path.join(cwd, "apply-mod.mjs"), "utf8");
const eventIsolation = patcher.slice(patcher.indexOf("  // 3. Isolate ephemeral"), patcher.indexOf("  // 4. Inject Codex"));
for (const fixture of [
  { reducer: "function de(e){switch(e.type){default:return e}}", listener: "D=e.sdk.event.listen(e=>{events.push(e)})", param: "e" },
  { reducer: "function renamed(evt){switch(evt.type){default:return evt}}", listener: "sub=ctx.sdk.event.listen(evt=>{events.push(evt)})", param: "evt" },
]) {
  const earlier = fixture.param === "e" ? "function unrelated(x){switch(x.type){default:return x}};other=ctx.sdk.event.listen(x=>{});" : "";
  const patched = vm.runInNewContext(eventIsolation + ";out", { out: earlier + fixture.reducer + ";" + fixture.listener });
  assert.ok(patched.startsWith(earlier), "Legacy preferred anchors must leave earlier unrelated switches/listeners untouched");
  assert.equal((patched.match(/startsWith\?\.\("ses_btw_"\)/g) || []).length, 2);
  const guard = patched.slice(patched.indexOf(`if(${fixture.param}?`), patched.indexOf("return;") + 7);
  for (const [id, expected] of [["ses_btw_test", 0], ["generated-id", 0], ["normal", 1]]) {
    assert.equal(vm.runInNewContext(`(()=>{${guard}return 1})()`, {
      [fixture.param]: { data: { sessionID: id } }, window: { __oc_active_btw_sessions: new Set(["generated-id"]) },
    }) ?? 0, expected);
  }
}
const patchRoute = vm.runInNewContext(patcher.slice(patcher.indexOf("function patchSessionRouteBundle("), patcher.indexOf("function main(")) + ";patchSessionRouteBundle");
const nativeActions = 'function footer(){return nativeCopy()}function fork(){return sdk.api.session.fork({sessionID:id,before:messageID})}';
const routeFixture = 'let a=ctrl(s),b=virt({sessionID:s.identity.sessionID,scrollRef:a.scroller});e.setRevealMessage?.((t,r)=>{let i=r?items().findIndex(x=>is(x,`AssistantPart`)&&x.group.type===`part`&&x.group.ref.partID===r):-1,n=i>=0?i:e.projection.messageRowIndex().get(t);n!==void 0&&(flush(),v.scrollToIndex(n,{align:i>=0?`center`:`start`}))});' + nativeActions;
const patchedRoute = patchRoute(routeFixture);
assert.ok(patchedRoute.endsWith(nativeActions), "Native copy and fork code must remain byte-identical");
assert.ok(patchedRoute.includes("window.__oc_timeline_ctrl"));
assert.ok(patchedRoute.includes("window.__oc_virtual_scroll"));
assert.ok(!patchedRoute.includes("__oc_fork"));
assert.throws(() => resolvePanelSymbols("", "", "export{}"), /未写入补丁/);
for (const answer of ["answer()", "answer().answer"]) {
  const fixture = 'import{render as md}from"./content.js";create(md,{get text(){return ' + answer + '},class:`text-14-regular`})';
  assert.deepEqual(resolvePanelChunkImport(fixture, "Markdown"), { file: "content.js", external: "render" });
}
assert.throws(() => resolvePanelChunkImport('import{t as md}from"./markdown-grammar.js"', "Markdown"), /未写入补丁/);

const tooltipImpl = 'function inner(e){let t,n,r,[i,a]=split(e,[`children`,`inactive`,`triggerTabIndex`,`value`]);return render(i,a)}';
const tooltipWrapper = 'function outer(e){return component(Show,{get when(){return!e.inactive},get fallback(){return e.children},get children(){return component(inner,e)}})}';
const tooltipExports = 'export{component as cc,Show as sh,outer as tip}';
assert.equal(resolveTooltipSymbol(tooltipImpl + 'export{inner as tip}', "cc", "sh"), "tip", "Keep directly exported legacy Tooltip");
assert.equal(resolveTooltipSymbol(tooltipWrapper + tooltipImpl + tooltipExports, "cc", "sh"), "tip", "Resolve the public 2.2.6 wrapper, not its private implementation");
const renamedTooltip = (tooltipWrapper + tooltipImpl + tooltipExports).replaceAll("outer", "$public").replaceAll("inner", "$private").replaceAll("component", "$create").replaceAll("Show", "$show");
assert.equal(resolveTooltipSymbol(renamedTooltip, "cc", "sh"), "tip", "No hardcoded minifier names");
const publicTooltip = vm.runInNewContext(tooltipWrapper + ';outer', {
  component: (fn, props) => fn(props), Show: props => props.when ? props.children : props.fallback,
  inner: props => ({ wrapped: props.value }),
});
assert.equal(publicTooltip({ inactive: true, children: "native-child" }), "native-child", "Keep official inactive/fallback behavior");
assert.equal(publicTooltip({ value: "tooltip-content" }).wrapped, "tooltip-content");
for (const invalid of [tooltipImpl + tooltipExports, tooltipWrapper.replace("return!e.inactive", "return e.inactive") + tooltipImpl + tooltipExports,
  tooltipWrapper.replace("component(Show", "unknown(Show") + tooltipImpl + tooltipExports,
  tooltipWrapper + tooltipWrapper.replaceAll("outer", "other") + tooltipImpl + tooltipExports,
  tooltipWrapper + tooltipImpl + tooltipImpl.replaceAll("inner", "duplicate") + tooltipExports,
  tooltipWrapper + tooltipImpl + tooltipExports.replace("outer as tip", "outer as tip,inner as ambiguous")]) {
  assert.throws(() => resolveTooltipSymbol(invalid, "cc", "sh"), /未写入补丁/, "Reject unknown, private or ambiguous Tooltip structures");
}

function checkTimelineBridge(route, userRows) {
  const matches = [...route.matchAll(/window\.__oc_virtual_scroll=(\{M:([\w$]+),be:([\w$]+),unpin:\3,getRowIndex:[\s\S]*?\}),([\w$]+)\.setRevealMessage/g)];
  assert.equal(matches.length, 1, "Emit exactly one virtual-scroll bridge, not just match the native callback");
  if (userRows === undefined) {
    const nativeReveal = route.slice(matches[0].index + matches[0][0].length).match(/^\?\.\(\([\w$]+,[\w$]+\)=>\{[^}]+?\.scrollToIndex/);
    assert.ok(nativeReveal, "Find the original reveal callback next to the bridge");
    userRows = nativeReveal[0].includes("UserMessage");
  }
  const [, expression, virtualizer, flush, receiver] = matches[0];
  const lookup = expression.match(/([\w$]+)\(\)\.findIndex\(([\w$]+)=>([\w$]+)\(\2,[`'"]AssistantPart[`'"]\)/);
  assert.ok(lookup, "Use the native row lookup and type predicate");
  let flushed = 0;
  const instance = {};
  const rows = [
    { kind: "UserMessage", userMessageID: "msg", group: { type: "user" } },
    { kind: "AssistantPart", group: { type: "part", ref: { partID: "part" } } },
  ];
  const bridge = vm.runInNewContext(`(${expression})`, {
    [virtualizer]: instance, [flush]: () => { flushed++; },
    [receiver]: { projection: { messageRowIndex: () => new Map([["msg", 8], ["projected", 9]]) } },
    [lookup[1]]: () => rows, [lookup[3]]: (row, kind) => row.kind === kind,
  });
  assert.equal(bridge.M, instance);
  assert.equal(bridge.be, bridge.unpin);
  bridge.unpin();
  assert.equal(flushed, 1, "Call the resolved native anchor/scroll-adjustment flusher");
  assert.equal(bridge.getRowIndex("msg", "part"), 1, "Prefer the exact assistant part");
  assert.equal(bridge.getRowIndex("msg", "missing"), userRows ? 0 : 8, "Keep native user-row vs projection precedence");
  assert.equal(bridge.getRowIndex("msg"), userRows ? 0 : 8);
  assert.equal(bridge.getRowIndex("projected"), 9);
  assert.equal(bridge.getRowIndex("missing"), undefined);
}

checkTimelineBridge(patchedRoute, false);
// 2.2.5 renamed the callback's second parameter and prefers actual user rows.
const routeFixtureV225 = 'let a=ctrl(s),b=virt({sessionID:s.identity.sessionID,scrollRef:a.scroller});e.setRevealMessage?.((t,n)=>{if(!active())return;let i=n?items().findIndex(x=>is(x,`AssistantPart`)&&x.group.type===`part`&&x.group.ref.partID===n):-1,a=items().findIndex(x=>is(x,`UserMessage`)&&x.userMessageID===t),o=i>=0?i:a>=0?a:e.projection.messageRowIndex().get(t);o!==void 0&&(clearAnchor(),v.scrollToIndex(o,{align:i>=0?`center`:`start`}))});cleanup(()=>e.setRevealMessage?.(()=>{}));' + nativeActions;
for (const fixture of [routeFixtureV225, routeFixtureV225.replaceAll("(t,n)", "(messageID,$part)").replaceAll("=n?", "=$part?").replaceAll("===n)", "===$part)").replaceAll("===t)", "===messageID)").replaceAll(".get(t)", ".get(messageID)"), routeFixtureV225.replaceAll("items()", "r()")]) {
  const patched = patchRoute(fixture);
  assert.ok(patched.includes(fixture.slice(fixture.indexOf("e.setRevealMessage"))), "Leave native reveal, copy and fork code byte-identical");
  checkTimelineBridge(patched, true);
}
assert.throws(() => patchRoute(routeFixtureV225 + routeFixtureV225), /virtual|reveal/i, "Reject ambiguous reveal callbacks");
assert.throws(() => patchRoute(routeFixtureV225.replace("clearAnchor(),", "")), /virtual|flusher|reveal/i, "Never guess a missing flusher name");
assert.throws(() => patchRoute(routeFixtureV225 + 'other.setRevealMessage?.((id)=>jump(id))'), /virtual|reveal/i, "Reject additional unknown reveal callbacks, not known no-op cleanup");

async function checkCompanionSetup(main, panelName) {
  const start = main.indexOf("=e=>{window.__oc_app_ext=e;") + 1;
  assert.ok(start > 0, "Find the emitted companion setup");
  const tail = main.slice(start).match(/get id\(\)\{return`main`\}\}\)\}\}\)\}\)\}/);
  assert.ok(tail, "Find the end of emitted companion setup");
  const setup = main.slice(start, start + tail.index + tail[0].length);
  const lazy = setup.match(/let t=([\w$]+)\(\(\)=>([\w$]+)\(/);
  const preload = setup.match(/;([\w$]+)\(([\w$]+)\(\(\)=>void t\.preload\(\)\)\)/);
  const store = setup.match(/i=([\w$]+)\(e\),a=([\w$]+)\(/);
  const render = setup.match(/render:p=>([\w$]+)\(([\w$]+),/);
  const registries = [...setup.matchAll(/e\.add\(([\w$]+),/g)].map(m => m[1]);
  assert.ok(lazy && preload && store && render);
  assert.ok(!setup.includes('import(`./' + panelName + '`),import.meta.url'), "Never omit Vite's dependency-array argument");
  let initialized = 0, loaded = 0, rendered = 0;
  const contributions = [];
  const session = { id: "session-test" };
  const layoutCalls = [];
  const ext = {
    sessions: { current: () => session }, t: key => key,
    layout: { narrow: () => false, toggle: (...args) => layoutCalls.push(args), state: () => "visible" },
    add: (registry, value) => contributions.push([registry, typeof value === "function" ? value() : value]),
  };
  const sandbox = {
    window: {}, console,
    __load: async name => {
      loaded++;
      assert.ok(name === `./${panelName}` || name === "./sidebar-codex.js");
      return { initCompanion: actual => { assert.equal(actual, ext); initialized++; }, default: () => { rendered++; return "panel"; } };
    },
    [lazy[1]]: load => Object.assign(() => { rendered++; return "panel"; }, { preload: load }),
    // Model Vite's actual array contract rather than accepting any second arg.
    [lazy[2]]: (load, deps, url) => {
      assert.ok(Array.isArray(deps), "Vite dependency list must stay in argument 2, including []");
      assert.equal(url, "oc://renderer/assets/main.js");
      deps.map(dep => assert.equal(typeof dep, "string"));
      return load();
    },
    [preload[1]]: () => {}, [preload[2]]: callback => callback,
    [store[1]]: () => ({}), [store[2]]: fn => fn,
    [render[1]]: (component, props) => component(props),
    [render[2]]: props => props.children,
    __vite__mapDeps: entries => entries.map(n => `asset-${n}.js`),
  };
  registries.forEach(name => { sandbox[name] = name; });
  const setupFn = vm.runInNewContext(`(${setup.replaceAll("import.meta.url", '"oc://renderer/assets/main.js"').replaceAll("import(", "__load(")})`, sandbox);
  setupFn(ext);
  await new Promise(setImmediate);
  assert.equal(initialized, 1, "Initialize timeline and quote hooks exactly once");
  assert.equal(loaded, 2, "Load companion and sidebar");
  assert.equal(sandbox.window.__oc_app_ext, ext);
  const command = contributions.find(([, value]) => value.id === "ask")[1];
  const side = contributions.find(([, value]) => value.region === "side")[1];
  assert.equal(command.enabled, true);
  command.run("");
  assert.equal(layoutCalls[0][0], "btw:main");
  assert.equal(side.list({ open: [] }).length, 0);
  assert.equal(side.list({ open: ["main"] })[0].id, "main");
  assert.equal(side.render({ session }), "panel");
  assert.equal(rendered, 1, "The registered side panel must render");
}

// Both dependency shapes must execute, not just pass syntax validation.
for (const deps of ["[]", "__vite__mapDeps([1,2])"]) {
  await checkCompanionSetup(`setup=e=>{window.__oc_app_ext=e;let t=lazy(()=>preload(()=>import(\`./panel-test.js\`),${deps},import.meta.url));cleanup(onMount(()=>void t.preload()));preload(()=>import(\`./panel-test.js\`),${deps},import.meta.url).then(m=>m.initCompanion?.(e));import(\`./sidebar-codex.js\`).then(m=>{window.__oc_cx_sidebar=m});let n=e.layout,r=e.sessions,i=store(e),a=memo(()=>!!r.current());e.add(cmd,()=>({id:\`ask\`,enabled:!n.narrow()&&a(),run:()=>n.toggle(\`btw:main\`,r.current())}));e.add(side,{region:\`side\`,list:t=>t.open.length?[{id:\`main\`}]:[],render:p=>component(suspense,{get children(){return component(t,{btw:i,get session(){return p.session},get id(){return\`main\`}})}})})}`, "panel-test.js");
}

const asarIndex = process.argv.indexOf("--asar");
if (asarIndex >= 0) {
  const original = fs.readFileSync(process.argv[asarIndex + 1]);
  function archive(buffer) {
    const header = JSON.parse(buffer.subarray(16, 16 + buffer.readUInt32LE(12)));
    const offset = 8 + buffer.readUInt32LE(4);
    function node(file) {
      return file.split("/").reduce((parent, name) => parent?.files?.[name], header);
    }
    function bytes(file) {
      const entry = node(file);
      assert.ok(entry, `Missing archive entry: ${file}`);
      return buffer.subarray(offset + Number(entry.offset), offset + Number(entry.offset) + entry.size);
    }
    return { header, node, bytes, read: file => bytes(file).toString() };
  }
  const clean = archive(original);
  const assetsPath = "out/renderer/assets/";
  const assets = clean.node(assetsPath.slice(0, -1)).files;
  const mainName = Object.keys(assets).find(name => /^main-.*\.js$/.test(name));
  const main = clean.read(assetsPath + mainName);
  const panelName = main.slice(main.indexOf("slash:{name:`btw`") - 1000, main.indexOf("slash:{name:`btw`"))
    .match(/import\([`'"]\.\/(panel-[^`'"]+)[`'"]\)/)[1];
  const routeName = Object.keys(assets).find(name => /^route-.*\.js$/.test(name) && assets[name].size > 200000);
  const route = clean.read(assetsPath + routeName);
  const symbols = resolvePanelSymbols(clean.read(assetsPath + panelName), route, main);
  const exports = new Map(main.slice(main.lastIndexOf("export{") + 7).split("}")[0].split(",").map(entry => {
    const [internal, external = internal] = entry.trim().split(/\s+as\s+/);
    return [external, internal];
  }));

  // Execute the exact Solid shipped in the official bundle, not test doubles.
  const runtimeStart = main.search(/var [\w$]+=[\w$]+\(\{\$DEVCOMP:/);
  const templateStart = main.indexOf("function " + exports.get(symbols.template) + "(");
  const rootName = main.slice(runtimeStart, templateStart).match(/createRoot:\(\)=>([\w$]+)/)[1];
  const loaderName = main.slice(runtimeStart).match(/^var [\w$]+=([\w$]+)\(/)[1];
  const runtime = vm.runInNewContext(main.slice(runtimeStart, templateStart) + `;({root:${rootName},${["createSignal", "createMemo", "createEffect", "onCleanup", "For"].map(key => `${key}:${exports.get(symbols[key])}`).join(",")}})`, { [loaderName]: () => ({}) });
  let cleaned = false;
  runtime.root(dispose => {
    const [value, set] = runtime.createSignal(1);
    const doubled = runtime.createMemo(() => value() * 2);
    assert.equal(doubled(), 2);
    set(3);
    assert.equal(doubled(), 6);
    assert.deepEqual(Array.from(runtime.For({ each: [1, 2], children: n => n * 2 })()), [2, 4]);
    runtime.createEffect(() => value());
    runtime.onCleanup(() => { cleaned = true; });
    dispose();
  });
  assert.equal(cleaned, true);

  const parent = process.platform === "win32" ? path.join(os.homedir(), "AppData/Local/Temp/opencode") : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(parent, "bundle-check-"));
  try {
    const target = path.join(dir, "app.asar");
    fs.copyFileSync(process.argv[asarIndex + 1], target);
    const apply = () => execFileSync(process.execPath, ["apply-mod.mjs", "--force"], { cwd, env: { ...process.env, OPENCODE_ASAR_PATH: target }, encoding: "utf8" });
    console.log(apply());
    const first = fs.readFileSync(target);
    apply();
    assert.deepEqual(fs.readFileSync(target), first);
    const patched = archive(first);
    console.log(execFileSync(process.execPath, ["--experimental-vm-modules", "module-link.check.mjs", target,
      panelName, mainName, routeName, "sidebar-codex.js", "chat-width.js", "voice-input.mjs", "long-text.mjs"], { cwd, encoding: "utf8" }));
    const patchedMain = patched.read(assetsPath + mainName);
    await checkCompanionSetup(patchedMain, panelName);
    // Execute the real companion module and initializer with the official Solid
    // primitives; only DOM/services are isolated. The setup test above stubs it.
    const panelSource = patched.read(assetsPath + panelName);
    if (symbols.Markdown) assert.match(panelSource, new RegExp(`${symbols.Markdown} as Markdown`), "Import the exact native Markdown component");
    const startupWindow = new EventTarget();
    let observers = 0, intervals = 0;
    const styleElements = new Map();
    const startupDocument = Object.assign(new EventTarget(), {
      head: { appendChild: el => styleElements.set(el.id, el) }, body: {},
      getElementById: id => styleElements.get(id), createElement: () => ({}), querySelector: () => null,
    });
    const startup = vm.runInNewContext(panelSource.replace(/import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?/g, "")
      .replace("export function initCompanion", "function initCompanion").replace(/export\s*\{\s*BtwPanel as default\s*\};?/, "") + ';({initCompanion})', {
      ...runtime, window: startupWindow, document: startupDocument, Element: class {},
      MutationObserver: class { observe() { observers++; } },
      localStorage: { getItem: () => null, setItem() {} },
      setInterval: () => { intervals++; }, requestAnimationFrame: fn => fn(), setTimeout, clearTimeout,
    });
    const toggles = [];
    const startupExt = { sessions: { current: () => undefined }, layout: { toggle: (...args) => toggles.push(args) } };
    startup.initCompanion(startupExt);
    startup.initCompanion(startupExt);
    assert.equal(observers, 2, "Start both real selection and timeline observers once");
    assert.equal(intervals, 1, "Start real timeline polling once");
    assert.equal(typeof startupWindow.__oc_btw_slash, "function");
    startupWindow.__oc_btw_slash("", { id: "startup-session" });
    assert.equal(toggles[0][0], "btw:main");
    assert.ok(patchedMain.includes("host.className='oc-cx-host-container"), "Do not silently skip Codex sidebar injection");
    const sidebarAt = patchedMain.indexOf("host.className='oc-cx-host-container");
    const sidebarStart = patchedMain.lastIndexOf("(()=>{var ", sidebarAt);
    // settings has its own IIFE: find the actual final return, not that closure.
    const sidebarReturn = patchedMain.indexOf("return ", patchedMain.indexOf("cxStart=m=>", sidebarAt));
    const sidebarFinish = patchedMain.indexOf("})()", sidebarReturn) + 4;
    const sidebarCode = patchedMain.slice(sidebarStart, sidebarFinish);
    const deps = sidebarCode.match(/var deps=\{servers:([\w$]+),tabsStore:([\w$]+),tabs:([\w$]+),current:\(\)=>([\w$]+)\(\),tabKey:([\w$]+),serverKey:([\w$]+)\.key,settings:\(\(\)=>\{try\{return ([\w$]+)\(\)/);
    const expr = sidebarCode.match(/orig=([\w$]+)\(([\w$]+),\{/);
    const template = sidebarCode.match(/^\(\(\)=>\{var ([\w$]+)=([\w$]+)\(\)/);
    const insert = sidebarCode.match(/return ([\w$]+)\(\w+,\[host,origWrap\]\)/);
    assert.ok(deps && expr && template && insert, "Resolve injected sidebar bindings");
    let mounted, cleaned = false, mountedHost;
    const nativeTabs = [{ id: "one" }], nativeStore = {}, nativeServers = {};
    const bindings = {
      [deps[1]]: nativeServers, [deps[2]]: nativeStore, [deps[3]]: nativeTabs,
      [deps[4]]: () => nativeTabs[0], [deps[5]]: tab => tab.id, [deps[6]]: { key: s => s.id }, [deps[7]]: () => ({}),
      [expr[1]]: (component, props) => props === undefined ? component() : ({ component, props }), [expr[2]]: () => {},
      [template[2]]: () => ({}), [insert[1]]: () => {},
      __oc_cx_onCleanup: fn => { bindings.dispose = fn; },
      document: { createElement: () => ({ style: {} }) },
      window: { __oc_cx_sidebar: { mount(host, deps) { mountedHost = host; mounted = deps; return () => { cleaned = true; }; } } },
    };
    vm.runInNewContext(sidebarCode, bindings);
    assert.equal(mounted.tabs, nativeTabs);
    assert.equal(mounted.tabsStore, nativeStore);
    assert.equal(mounted.servers, nativeServers);
    assert.equal(mounted.current(), nativeTabs[0]);
    assert.equal(mounted.tabKey(nativeTabs[0]), "one");
    assert.ok(mountedHost.className.includes("oc-cx-host-container"));
    bindings.dispose();
    assert.equal(cleaned, true, "Dispose sidebar on native container cleanup");

    // Run the shipped adapter too: a successful mount alone cannot prove that
    // a changed Global context API can still supply projects/history.
    const adapterSource = fs.readFileSync(path.join(cwd, "cx-sidebar.js"), "utf8")
      .replace("export function mount", "function mount")
      .replace("  injectStyle();", '  host.check={api};render=(model)=>{host.model=model;};');
    const adapterScope = {
      document: Object.assign(new EventTarget(), { documentElement: { lang: "en" } }), window: new EventTarget(),
      localStorage: { getItem: () => null, setItem() {} }, setInterval: () => 1, clearInterval() {},
      setTimeout, clearTimeout, AbortController,
    };
    const adapterMount = vm.runInNewContext(adapterSource + ';mount', adapterScope);
    const adapterHost = { style: {}, classList: { add() {} }, addEventListener() {}, querySelectorAll: () => [], isConnected: true };
    const context = {
      isLocal: true, projects: { used: () => [{ id: "native-project", name: "Native project", worktree: "/native", sandboxes: [] }] },
      data: { session: { list: () => [] } },
      sdk: { connection: { status: () => "connected" }, api: { session: { list: async () => ({
        data: [{ id: "native-session", title: "Native session", projectID: "native-project", location: { directory: "/native" }, time: { created: 1 } }], cursor: {},
      }) } } },
    };
    const connection = { id: "native-server" };
    const lookup = key => { assert.equal(key, "native-server"); return context; };
    const hasModernContext = /serverCtx\([\w$]+\)\{return/.test(main);
    const adapterDispose = adapterMount(adapterHost, { ...mounted, tabs: [], current: () => undefined,
      servers: { servers: { list: () => [connection] }, ...(hasModernContext ? { serverCtx: lookup } : { ensureServerCtx: () => context }) },
    });
    await adapterHost.check.api.refresh();
    const adapterSnapshot = adapterHost.check.api.snapshot();
    assert.equal(adapterSnapshot.servers[0]?.projects[0]?.worktree, "/native", "Read actual project data, not just mount an empty shell");
    assert.equal(adapterSnapshot.servers[0]?.sessions[0]?.id, "native-session", "Read history through the official context API shape");
    adapterDispose();
    const result = patched.read(assetsPath + routeName);
    assert.equal(result, patchRoute(route));
    checkTimelineBridge(result);
    assert.ok(result.includes("ui.message.forkMessage"), "Keep official fork action");
    const copyFooter = route.match(/function [\w$]+\(e\)\{(?:(?!function [\w$]+\(e\)\{)[\s\S])*?ui\.message\.copyResponse[\s\S]*?\}\}/)?.[0];
    assert.ok(copyFooter && result.includes(copyFooter), "Do not inject into assistant footer");
    const nativeQuoteAt = route.indexOf("data-component=timeline-quote");
    if (nativeQuoteAt >= 0) {
      const nativeQuoteStart = route.lastIndexOf("var ", nativeQuoteAt);
      const nativeQuoteEndMatch = route.slice(nativeQuoteAt).match(/[\w$]+\(\[`mousedown`\]\);/);
      const nativeQuoteEnd = nativeQuoteEndMatch ? nativeQuoteAt + nativeQuoteEndMatch.index : -1;
      assert.ok(nativeQuoteStart >= 0 && nativeQuoteEnd > nativeQuoteAt, "Resolve native quote toolbar/controller boundaries");
      assert.ok(result.includes(route.slice(nativeQuoteStart, nativeQuoteEnd)), "Keep the entire official quote toolbar/controller byte-identical");
    }
    let checked = 0;
    function walk(tree, prefix = "") {
      for (const [name, entry] of Object.entries(tree.files || {})) {
        const file = prefix + name;
        if (entry.files) { walk(entry, file + "/"); continue; }
        const old = clean.node(file);
        if (old?.offset === entry.offset && old?.size === entry.size || !/\.m?js$|\.cjs$/.test(name)) continue;
        const bytes = patched.bytes(file);
        assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), entry.integrity.hash);
        const tempFile = path.join(dir, `${checked++}-${name}`);
        fs.writeFileSync(tempFile, bytes);
        execFileSync(process.execPath, ["--check", tempFile]);
        const source = bytes.toString();
        for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)["'`](\.[^"'`]+)["'`]/g)) {
          assert.ok(patched.node(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]))), `Missing import ${match[1]} in ${file}`);
        }
        // Existence alone is insufficient: stale aliases can name unrelated functions.
        for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']\.\/main-[^"']+["']/g)) {
          for (const entry of match[1].split(",").filter(s => s.trim())) {
            assert.ok(exports.has(entry.trim().split(/\s+as\s+/)[0]), `Unknown main export: ${entry}`);
          }
        }
      }
    }
    walk(patched.header);
    console.log(`Official ASAR integration passed: ${checked} changed scripts, real module linking, integrity, native fork/quote/footer, Solid runtime, real companion startup, sidebar data and idempotence.`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log("Bundle checks passed: native actions preserved, virtual-scroll bridge execution/row precedence, unknown symbols rejected, empty/mapped Vite dependencies and companion setup/render.");
