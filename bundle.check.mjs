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
const routeFixture = 'let a=ctrl(s),b=virt({sessionID:s.identity.sessionID,scrollRef:a.scroller});e.setRevealMessage?.((t,r)=>{let i=r?items().findIndex(x=>is(x,`AssistantPart`)&&x.group.type===`part`):0;flush(),v.scrollToIndex(i)});' + nativeActions;
const patchedRoute = patchRoute(routeFixture);
assert.ok(patchedRoute.endsWith(nativeActions), "Native copy and fork code must remain byte-identical");
assert.ok(patchedRoute.includes("window.__oc_timeline_ctrl"));
assert.ok(patchedRoute.includes("window.__oc_virtual_scroll"));
assert.ok(!patchedRoute.includes("__oc_fork"));
assert.throws(() => resolvePanelSymbols("", "", "export{}"), /未写入补丁/);

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
    assert.ok(result.includes("ui.message.forkMessage"), "Keep official fork action");
    const copyFooter = route.match(/function [\w$]+\(e\)\{(?:(?!function [\w$]+\(e\)\{)[\s\S])*?ui\.message\.copyResponse[\s\S]*?\}\}/)?.[0];
    assert.ok(copyFooter && result.includes(copyFooter), "Do not inject into assistant footer");
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
console.log("Bundle checks passed: native actions preserved, unknown symbols rejected, empty/mapped Vite dependencies and companion setup/render.");
