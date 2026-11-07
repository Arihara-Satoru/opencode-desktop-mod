import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolvePanelSymbols } from "./bundle-symbols.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const patcher = fs.readFileSync(path.join(cwd, "apply-mod.mjs"), "utf8");
const patchRoute = vm.runInNewContext(patcher.slice(patcher.indexOf("function patchSessionRouteBundle("), patcher.indexOf("function main(")) + ";patchSessionRouteBundle");
const nativeActions = 'function footer(){return nativeCopy()}function fork(){return sdk.api.session.fork({sessionID:id,before:messageID})}';
const routeFixture = 'let a=ctrl(s),b=virt({sessionID:s.identity.sessionID,scrollRef:a.scroller});e.setRevealMessage?.((t,r)=>{let i=r?items().findIndex(x=>is(x,`AssistantPart`)&&x.group.type===`part`&&x.group.ref.partID===r):-1,n=i>=0?i:e.projection.messageRowIndex().get(t);n!==void 0&&(flush(),v.scrollToIndex(n,{align:i>=0?`center`:`start`}))});' + nativeActions;
const patchedRoute = patchRoute(routeFixture);
assert.ok(patchedRoute.endsWith(nativeActions), "Native copy and fork code must remain byte-identical");
assert.ok(patchedRoute.includes("window.__oc_timeline_ctrl"));
assert.ok(patchedRoute.includes("window.__oc_virtual_scroll"));
assert.ok(!patchedRoute.includes("__oc_fork"));
assert.throws(() => resolvePanelSymbols("", "", "export{}"), /未写入补丁/);

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

// Verify assistant message footer speed patch (T/s) and tooltip
const pcFixture = 'function pc(e){let n=Xi(),r=at(),i=m(),a=t(()=>new Intl.NumberFormat(r.locale())),o=!1;u=t(()=>{let t=e.message.time.completed,n=e.turnDurationMs===null?-1:e.turnDurationMs===void 0?t===void 0?-1:t-e.message.time.created:e.turnDurationMs;if(!(n>=0))return``;let i=Math.round(n/1e3);return i<60?r.t(`ui.message.duration.seconds`,{count:a().format(i)}):r.t(`ui.message.duration.minutesSeconds`,{minutes:a().format(Math.floor(i/60)),seconds:a().format(i%60)})}),d=Ir(`(max-width: 767px)`),f=t(()=>[...d()?[]:l(),...[u(),c()?r.t(`ui.message.interrupted`):``].flatMap(e=>e?[{label:e}]:[])])}function Ws(e){return W(H,{get each(){return e.items},children:(t,n)=>[q(n,()=>t.label),K(r=>{var i=`${e.slot}-meta-item`,a=t.variant?``:void 0,o=e.slot===`text-part`?`auto`:void 0;return i!==r.e&&R(n,`data-slot`,r.e=i),r},{e:void 0})])]})}';
const patchedRouteWithSpeed = patchRoute(routeFixtureV225 + pcFixture);
assert.ok(patchedRouteWithSpeed.includes("__oc_speed="), "Speed memo must be emitted");
assert.ok(patchedRouteWithSpeed.includes("[u(),__oc_speed(),"), "Speed memo must be included after duration");
assert.ok(patchedRouteWithSpeed.includes(".title&&R("), "Ws must bind title attribute for token details tooltip");

// Execute speed calculation in sandbox
const speedSnippet = patchedRouteWithSpeed.match(/__oc_speed=t\(\(\)=>\{([\s\S]*?)\}\),/);
assert.ok(speedSnippet, "Extract speed memo body");
function evalSpeed(message, locale = "zh-CN") {
  return vm.runInNewContext(`(() => { let e = { message }; let r = { locale: () => "${locale}" }; ${speedSnippet[1]} })()`, { Number, Math, message });
}
const geminiSpeed = evalSpeed({
  time: { created: 10000, streamed: 22682 },
  tokens: { output: 283, reasoning: 519 }
});
assert.equal(geminiSpeed.label, "63.2 T/s");
assert.ok(geminiSpeed.title.includes("802 tokens (283 输出 + 519 思考) / 12.7 秒"));

const enSpeed = evalSpeed({
  time: { created: 10000, completed: 12500 },
  tokens: { output: 150 }
}, "en-US");
assert.equal(enSpeed.label, "60.0 T/s");
assert.ok(enSpeed.title.includes("150 tokens / 2.5s"));

assert.equal(evalSpeed({ tokens: undefined }), "");
assert.equal(evalSpeed({ tokens: { output: 0 } }), "");


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
    await checkCompanionSetup(patched.read(assetsPath + mainName), panelName);
    const result = patched.read(assetsPath + routeName);
    assert.equal(result, patchRoute(route));
    checkTimelineBridge(result);
    assert.ok(result.includes("ui.message.forkMessage"), "Keep official fork action");
    const copyFooter = route.match(/function [\w$]+\(e\)\{(?:(?!function [\w$]+\(e\)\{)[\s\S])*?ui\.message\.copyResponse[\s\S]*?\}\}/)?.[0];
    assert.ok(copyFooter && result.includes(copyFooter), "Do not inject into assistant footer");
    const nativeQuoteAt = route.indexOf("data-component=timeline-quote");
    if (nativeQuoteAt >= 0) {
      const nativeQuoteStart = route.lastIndexOf("var ", nativeQuoteAt);
      const nativeQuoteEnd = route.indexOf('s([`mousedown`]);', nativeQuoteAt);
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
    console.log(`Official ASAR integration passed: ${checked} changed scripts, imports, exports, integrity, native fork/footer, Solid runtime, companion setup/render and idempotence.`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log("Bundle checks passed: native actions preserved, virtual-scroll bridge execution/row precedence, unknown symbols rejected, empty/mapped Vite dependencies and companion setup/render.");
