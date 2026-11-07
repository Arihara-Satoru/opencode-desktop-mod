import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// Run with --experimental-vm-modules. Link only: never execute application code,
// connect to a service or touch user storage. V8 validates every named import.
export async function linkRendererModules(read, roots) {
  const context = vm.createContext({});
  const modules = new Map();
  const load = file => {
    if (!modules.has(file)) modules.set(file, new vm.SourceTextModule(read(file), { context, identifier: file }));
    return modules.get(file);
  };
  for (const root of roots) {
    const module = load(root);
    if (module.status === "unlinked") await module.link((specifier, parent) => {
      assert.ok(specifier.startsWith("."), `Unexpected external renderer dependency ${specifier}`);
      return load(path.posix.normalize(path.posix.join(path.posix.dirname(parent.identifier), specifier)));
    });
  }
  return modules.size;
}

if (process.argv[2]) {
  const buffer = fs.readFileSync(process.argv[2]);
  const header = JSON.parse(buffer.subarray(16, 16 + buffer.readUInt32LE(12)));
  const offset = 8 + buffer.readUInt32LE(4);
  const read = file => {
    const entry = file.split("/").reduce((node, key) => node?.files?.[key], header);
    assert.ok(entry, `Missing linked module ${file}`);
    return buffer.subarray(offset + Number(entry.offset), offset + Number(entry.offset) + entry.size).toString();
  };
  const count = await linkRendererModules(read, process.argv.slice(3).map(name => "out/renderer/assets/" + name));
  console.log(`Renderer ES module linking passed: ${count} real modules, all static imports/exports validated without evaluation.`);
} else {
  const valid = { "panel.js": 'import {render} from "./component.js";export const panel=render;', "component.js": 'export const render=()=>{};' };
  assert.equal(await linkRendererModules(file => valid[file], ["panel.js"]), 2);
  const broken = { ...valid, "component.js": 'export default "grammar";' };
  await assert.rejects(linkRendererModules(file => broken[file], ["panel.js"]), /does not provide an export named/);
  assert.equal(await linkRendererModules(file => ({
    "a.js": 'import {b} from "./b.js";export const a=()=>b;',
    "b.js": 'import {a} from "./a.js";export const b=()=>a;',
  })[file], ["a.js"]), 2, "Handle native cyclic module graphs without evaluating app code");
  console.log("ES module linker regression passed: valid/cyclic graphs accepted, missing named exports rejected.");
}
