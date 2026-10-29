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
    console.log(`Official ASAR integration passed: ${checked} changed scripts, imports, exports, integrity, native fork/footer, Solid runtime and idempotence.`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log("Bundle checks passed: native actions preserved and unknown symbols rejected.");
